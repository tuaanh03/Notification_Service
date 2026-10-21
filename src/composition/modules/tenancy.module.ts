import { assertPasswordAllowed } from '../../modules/tenancy/domain/index.ts';
import {
  AuthenticateAdminSession,
  CreateAccount,
  CreateAdmin,
  CreateOrganization,
  CreateOwnOrganization,
  DescribeAdmins,
  DUMMY_PASSWORD,
  FindOrganization,
  FindOrgMemberships,
  ListDirectoryPeople,
  ListMemberCandidates,
  ListOrgMembers,
  RemoveOrgMember,
  ListAccounts,
  ListLoginLocks,
  LoginAdmin,
  LoginThrottle,
  LoginAdminWithMicrosoft,
  LogoutAdmin,
  SetAdminPassword,
  SetOrgMember,
  StartMicrosoftLogin,
  SetMemberListed,
  SyncTenantDirectory,
  UnlockLogin,
  type MicrosoftIdentity,
  type TenantDirectory,
} from '../../modules/tenancy/application/index.ts';
import {
  DrizzleAccountRepository,
  DrizzleAdminRepository,
  DrizzleAdminSessionRepository,
  DrizzleOrganizationRepository,
  DrizzleOrgMemberRepository,
  DisabledMicrosoftIdentity,
  DisabledTenantDirectory,
  EntraIdMicrosoftIdentity,
  GraphTenantDirectory,
  RandomSessionTokenFactory,
  RedisLoginAttemptStore,
  RedisLoginStateStore,
  ScryptPasswordHasher,
  SettingsLoginThrottlePolicy,
} from '../../modules/tenancy/infrastructure/adapters/index.ts';
import { adminTenancyRoutes, authRoutes, loginSecurityRoutes, SessionAdminAuthenticator } from '../../modules/tenancy/interface/index.ts';
import type { SystemSettingsQueries } from '../../modules/settings/application/index.ts';
import type { Container } from '../container.ts';
import type { ModuleDefinition } from '../module-definition.ts';

/**
 * Hạn TUYỆT ĐỐI của một phiên đăng nhập: 12 tiếng — đủ một ngày làm việc rồi phải đăng nhập lại.
 * Cố ý KHÔNG gia hạn trượt, và cố ý KHÔNG lấy từ env: đây là quyết định bảo mật, không phải thứ
 * để mỗi môi trường tự chỉnh. Đổi thì đổi ở đây, có lịch sử git.
 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Chờ Microsoft tối đa 8 giây mỗi lời gọi — dưới hạn 10 giây console chờ backend. */
const M365_TIMEOUT_MS = 8_000;
/** Mỗi trang danh bạ (≤ 999 người) chờ Graph tối đa 15 giây — đồng bộ do người bấm, không nằm trên đường đăng nhập. */
const DIRECTORY_TIMEOUT_MS = 15_000;

/**
 * Việc chỉ CLI gọi — KHÔNG có route HTTP nào (`entrypoints/admin-cli`).
 *
 * Admin đầu tiên phải tạo được khi chưa ai đăng nhập được. Cho việc đó đi qua HTTP thì lại cần
 * một token toàn quyền trong env — đúng thứ đã bỏ. Ai chạy được CLI thì đã có quyền trên máy chủ.
 */
export interface AdminOps {
  /**
   * Kiểm luật mật khẩu TRƯỚC khi chạm database. CLI cần nó vì `--account-name` tạo account thật:
   * đọc mật khẩu sau thì mật khẩu hỏng sẽ để lại một account rác không xoá được qua giao diện.
   */
  assertPasswordAllowed: (plaintext: string) => void;
  createAccount: CreateAccount;
  listAccounts: ListAccounts;
  createAdmin: CreateAdmin;
  setAdminPassword: SetAdminPassword;
  /** Thêm người vào org / đổi vai (ADR-0022). Màn Thành viên dùng chung qua `PUT …/members` (ADR-0026). */
  setOrgMember: SetOrgMember;
  /** Mở khoá đăng nhập (ADR-0039) — lối dự phòng khi chính Super Admin bị khoá. */
  unlockLogin: UnlockLogin;
}

/**
 * Ghép module tenancy. Trả thêm bốn cửa công khai:
 *   `findOrganization`   — cho module apps (qua adapter của nó).
 *   `findOrgMemberships` — vai trong org, cho lớp kiểm quyền của module apps (ADR-0022).
 *   `adminAuthenticator` — xác thực MỌI route `/admin/*`.
 *   `adminOps`           — use case cho CLI.
 */
export function tenancyModule(
  container: Container,
  dependencies: {
    systemSettings: SystemSettingsQueries;
    microsoftIdentity?: MicrosoftIdentity | undefined;
    tenantDirectory?: TenantDirectory | undefined;
  },
): {
  definition: ModuleDefinition;
  findOrganization: FindOrganization;
  findOrgMemberships: FindOrgMemberships;
  /** Cho module apps: gỡ thành viên + thu hồi vai app trong cùng transaction (ADR-0026). */
  removeOrgMember: RemoveOrgMember;
  adminAuthenticator: SessionAdminAuthenticator;
  adminOps: AdminOps;
  /** Cho module audit: email + tên người làm trên nhật ký chung. */
  describeAdmins: DescribeAdmins;
} {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const accounts = new DrizzleAccountRepository({ transactions });
  const organizations = new DrizzleOrganizationRepository({ transactions });
  const admins = new DrizzleAdminRepository({ transactions });
  const sessions = new DrizzleAdminSessionRepository({ transactions });
  const passwords = new ScryptPasswordHasher();
  const tokens = new RandomSessionTokenFactory();
  const members = new DrizzleOrgMemberRepository({ transactions });
  const findOrganization = new FindOrganization({ organizations });

  // Băm MỘT lần lúc khởi động để `LoginAdmin` luôn tốn chừng đó thời gian, kể cả khi email không
  // tồn tại. Để nguyên Promise (không await): dựng container vẫn đồng bộ, scrypt chạy nền ~100 ms.
  const dummyHash = passwords.hash(DUMMY_PASSWORD);

  const authenticateAdminSession = new AuthenticateAdminSession({ clock, admins, sessions, tokens });
  const createAccount = new CreateAccount({ uow, outbox, clock, accounts });
  const sessionDeps = { uow, outbox, clock, sessions, tokens, sessionTtlMs: SESSION_TTL_MS };
  const microsoftIdentity = dependencies.microsoftIdentity ?? selectMicrosoftIdentity(container);
  const setOrgMember = new SetOrgMember({ uow, outbox, clock, organizations, admins, members });
  // Bộ đếm đăng nhập sai (ADR-0039): Redis dùng chung mọi bản api, con số từ cài đặt hệ thống `auth.*`.
  const attempts = new RedisLoginAttemptStore({ redis: container.infra.redis.client });
  const throttle = new LoginThrottle({
    uow,
    outbox,
    clock,
    logger: container.ports.logger.child('login-throttle'),
    admins,
    sessions,
    attempts,
    policy: new SettingsLoginThrottlePolicy(dependencies),
  });
  const unlockLogin = new UnlockLogin({ uow, outbox, clock, admins, attempts });

  return {
    findOrganization,
    describeAdmins: new DescribeAdmins({ admins }),
    removeOrgMember: new RemoveOrgMember({ uow, outbox, organizations, members }),
    findOrgMemberships: new FindOrgMemberships({ members, admins }),
    adminAuthenticator: new SessionAdminAuthenticator({ authenticateAdminSession }),
    adminOps: {
      assertPasswordAllowed,
      createAccount,
      listAccounts: new ListAccounts({ accounts }),
      createAdmin: new CreateAdmin({ uow, outbox, clock, accounts, admins, passwords }),
      setAdminPassword: new SetAdminPassword({ uow, outbox, clock, admins, sessions, passwords }),
      setOrgMember,
      unlockLogin,
    },
    definition: {
      name: 'tenancy',
      http: {
        // Không xác thực — đây là cửa để LẤY phiên. Xem `auth.routes.ts`.
        public: [
          authRoutes({
            loginAdmin: new LoginAdmin({
              uow,
              outbox,
              clock,
              admins,
              sessions,
              passwords,
              tokens,
              sessionTtlMs: SESSION_TTL_MS,
              dummyHash,
              throttle,
            }),
            logoutAdmin: new LogoutAdmin({ uow, outbox, sessions, tokens }),
            authenticateAdminSession,
            startMicrosoftLogin: new StartMicrosoftLogin({ identity: microsoftIdentity }),
            loginAdminWithMicrosoft: new LoginAdminWithMicrosoft({ ...sessionDeps, identity: microsoftIdentity, admins, accounts }),
            clientIpSecret: container.env.LOGIN_CLIENT_IP_SECRET ?? null,
          }),
        ],
        admin: [
          loginSecurityRoutes({ listLoginLocks: new ListLoginLocks({ clock, admins, attempts }), unlockLogin }),
          adminTenancyRoutes({
            createAccount,
            createOrganization: new CreateOrganization({ uow, outbox, clock, accounts, organizations }),
            createOwnOrganization: new CreateOwnOrganization({ uow, outbox, clock, admins, organizations, members }),
            findOrganization,
            listOrgMembers: new ListOrgMembers({ members, admins }),
            listMemberCandidates: new ListMemberCandidates({ organizations, members, admins }),
            setOrgMember,
            listDirectoryPeople: new ListDirectoryPeople({ admins }),
            setMemberListed: new SetMemberListed({ uow, outbox, clock, admins }),
            syncTenantDirectory: new SyncTenantDirectory({
              uow,
              outbox,
              clock,
              directory: dependencies.tenantDirectory ?? selectTenantDirectory(container),
              accounts,
              admins,
            }),
          }),
        ],
      },
    },
  };
}

/** Đủ bốn biến `M365_*` (env đã ép đủ-hoặc-trống) -> Entra ID; trống -> tắt, console chỉ còn mật khẩu. */
function selectMicrosoftIdentity(container: Container): MicrosoftIdentity {
  const { M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, M365_REDIRECT_URI } = container.env;
  if (!M365_TENANT_ID || !M365_CLIENT_ID || !M365_CLIENT_SECRET || !M365_REDIRECT_URI) return new DisabledMicrosoftIdentity();
  return new EntraIdMicrosoftIdentity({
    config: {
      tenantId: M365_TENANT_ID,
      clientId: M365_CLIENT_ID,
      clientSecret: M365_CLIENT_SECRET,
      redirectUri: M365_REDIRECT_URI,
      timeoutMs: M365_TIMEOUT_MS,
    },
    states: new RedisLoginStateStore({ redis: container.infra.redis.client }),
    clock: container.ports.clock,
  });
}

/**
 * Danh bạ M365 đọc bằng app `GRAPH_*` (ADR-0027). Thiếu một trong ba biến -> tắt. Tenant của `GRAPH_*`
 * khác tenant đăng nhập `M365_*` -> cũng tắt: `oid` của tenant này không bao giờ khớp claim `oid`
 * của tenant kia, đồng bộ sẽ tạo tài khoản không ai đăng nhập vào được.
 */
function selectTenantDirectory(container: Container): TenantDirectory {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, M365_TENANT_ID } = container.env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) return new DisabledTenantDirectory('M365_DIRECTORY_NOT_CONFIGURED');
  if (M365_TENANT_ID && M365_TENANT_ID.toLowerCase() !== GRAPH_TENANT_ID.toLowerCase()) {
    return new DisabledTenantDirectory('M365_DIRECTORY_TENANT_MISMATCH');
  }
  return new GraphTenantDirectory({
    config: { tenantId: GRAPH_TENANT_ID, clientId: GRAPH_CLIENT_ID, clientSecret: GRAPH_CLIENT_SECRET, timeoutMs: DIRECTORY_TIMEOUT_MS },
  });
}
