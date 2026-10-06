import { assertPasswordAllowed } from '../../modules/tenancy/domain/index.ts';
import {
  AuthenticateAdminSession,
  CreateAccount,
  CreateAdmin,
  CreateOrganization,
  DUMMY_PASSWORD,
  FindOrganization,
  ListAccounts,
  LoginAdmin,
  LoginAdminWithMicrosoft,
  LogoutAdmin,
  SetAdminPassword,
  StartMicrosoftLogin,
  type MicrosoftIdentity,
} from '../../modules/tenancy/application/index.ts';
import {
  DrizzleAccountRepository,
  DrizzleAdminRepository,
  DrizzleAdminSessionRepository,
  DrizzleOrganizationRepository,
  DisabledMicrosoftIdentity,
  EntraIdMicrosoftIdentity,
  RandomSessionTokenFactory,
  RedisLoginStateStore,
  ScryptPasswordHasher,
} from '../../modules/tenancy/infrastructure/adapters/index.ts';
import { adminTenancyRoutes, authRoutes, SessionAdminAuthenticator } from '../../modules/tenancy/interface/index.ts';
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
}

/**
 * Ghép module tenancy. Trả thêm ba cửa công khai:
 *   `findOrganization`   — cho module apps (qua adapter của nó).
 *   `adminAuthenticator` — xác thực MỌI route `/admin/*`.
 *   `adminOps`           — use case cho CLI.
 */
export function tenancyModule(
  container: Container,
  dependencies: { microsoftIdentity?: MicrosoftIdentity | undefined } = {},
): {
  definition: ModuleDefinition;
  findOrganization: FindOrganization;
  adminAuthenticator: SessionAdminAuthenticator;
  adminOps: AdminOps;
} {
  const { uow, outbox, clock } = container.ports;
  const { transactions } = container.infra;

  const accounts = new DrizzleAccountRepository({ transactions });
  const organizations = new DrizzleOrganizationRepository({ transactions });
  const admins = new DrizzleAdminRepository({ transactions });
  const sessions = new DrizzleAdminSessionRepository({ transactions });
  const passwords = new ScryptPasswordHasher();
  const tokens = new RandomSessionTokenFactory();
  const findOrganization = new FindOrganization({ organizations });

  // Băm MỘT lần lúc khởi động để `LoginAdmin` luôn tốn chừng đó thời gian, kể cả khi email không
  // tồn tại. Để nguyên Promise (không await): dựng container vẫn đồng bộ, scrypt chạy nền ~100 ms.
  const dummyHash = passwords.hash(DUMMY_PASSWORD);

  const authenticateAdminSession = new AuthenticateAdminSession({ clock, admins, sessions, tokens });
  const createAccount = new CreateAccount({ uow, outbox, clock, accounts });
  const sessionDeps = { uow, outbox, clock, sessions, tokens, sessionTtlMs: SESSION_TTL_MS };
  const microsoftIdentity = dependencies.microsoftIdentity ?? selectMicrosoftIdentity(container);

  return {
    findOrganization,
    adminAuthenticator: new SessionAdminAuthenticator({ authenticateAdminSession }),
    adminOps: {
      assertPasswordAllowed,
      createAccount,
      listAccounts: new ListAccounts({ accounts }),
      createAdmin: new CreateAdmin({ uow, outbox, clock, accounts, admins, passwords }),
      setAdminPassword: new SetAdminPassword({ uow, outbox, clock, admins, sessions, passwords }),
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
            }),
            logoutAdmin: new LogoutAdmin({ uow, outbox, sessions, tokens }),
            authenticateAdminSession,
            startMicrosoftLogin: new StartMicrosoftLogin({ identity: microsoftIdentity }),
            loginAdminWithMicrosoft: new LoginAdminWithMicrosoft({ ...sessionDeps, identity: microsoftIdentity, admins }),
          }),
        ],
        admin: [
          adminTenancyRoutes({
            createAccount,
            createOrganization: new CreateOrganization({ uow, outbox, clock, accounts, organizations }),
            findOrganization,
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
