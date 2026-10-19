import { createInterface } from 'node:readline/promises';
import { buildApplication, createContainer, type Container } from '../../composition/index.ts';
import { AccountId, ADMIN_ROLES, APP_ROLES, AppId, OrgId, ORG_ROLES } from '../../shared/kernel/index.ts';
import type { Env } from '../../shared/config/index.ts';

/**
 * CLI quản trị — chạy TRONG container, nói thẳng với database, không đi qua HTTP.
 *
 * Đây là lời giải cho thế bí con gà/quả trứng sau khi bỏ `ADMIN_TOKEN`: admin đầu tiên phải tạo
 * được khi chưa ai đăng nhập được. Cho việc này đi qua HTTP thì lại phải có một token toàn quyền
 * nằm trong env — đúng thứ vừa gỡ đi, và là một cửa mở ra MẠNG. Còn CLI thì ai chạy được đã có
 * quyền trên máy chủ rồi: không mở thêm bề mặt tấn công nào.
 *
 * Mật khẩu LUÔN đọc qua stdin, không bao giờ nhận từ tham số dòng lệnh — tham số nằm lại trong
 * lịch sử shell và trong `ps`.
 */
const USAGE = `admin-cli — quản trị admin, chạy trong container

  create-admin   --email <email> --role super_admin|user [--account <id>] [--account-name <tên>]
                 [--login password|m365]
  reset-password --email <email>
  set-member     --org <orgId> --email <email> --role owner|org_admin|member
  grant-app-role --app <appId> --email <email> --role app_admin|app_viewer
  list-accounts
  scan-template-html   CHẠY THỬ, chỉ đọc: template kiểu html nào sẽ bị bộ kiểm an toàn (ADR-0036) chặn

Mật khẩu nhập qua stdin (nhắc 2 lần), không truyền bằng tham số.
--login m365: không đặt mật khẩu — người này chỉ đăng nhập bằng Microsoft 365 (khớp theo email).
Đặt mật khẩu sau được bằng reset-password.
--role bắt buộc: super_admin thấy và làm được mọi thứ; user chỉ thấy org / app được gán (ADR-0022).
set-member thêm người ĐÃ CÓ tài khoản vào org, hoặc đổi vai; org luôn phải còn ít nhất một owner.
grant-app-role chỉ cấp được cho thành viên của org sở hữu app.
Chưa có account nào thì create-admin cần --account-name để tạo account đầu tiên.
Có đúng một account thì tự chọn account đó, không cần --account.`;

interface Args {
  command: string | undefined;
  flags: Map<string, string>;
}

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  const [command, ...rest] = argv;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) throw new Error(`tham số lạ: ${token}`);
    const name = token.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} thiếu giá trị`);
    flags.set(name, value);
    i += 1;
  }
  return { command, flags };
}

/**
 * Nhắc nhập mật khẩu hai lần và so khớp. Không có cách ẩn ký tự trong TTY trần — nói rõ điều đó.
 *
 * Đọc bằng async iterator chứ không phải `rl.question`: khi stdin là ống dẫn (`docker exec -T`,
 * script) và hết dữ liệu, `question` KHÔNG bao giờ resolve và lệnh treo vô hạn. Iterator thì kết
 * thúc, và ở đây đổi thành một lỗi nói rõ lý do.
 */
async function readPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string> => {
    process.stderr.write(prompt);
    const { value, done } = await lines.next();
    if (done === true || value === undefined) throw new Error('stdin kết thúc trước khi nhập đủ mật khẩu');
    return value;
  };
  try {
    const first = await ask('Mật khẩu mới (ký tự sẽ hiện trên màn hình): ');
    const again = await ask('Nhập lại: ');
    if (first !== again) throw new Error('hai lần nhập không khớp');
    return first;
  } finally {
    rl.close();
  }
}

/**
 * Đọc và kiểm mật khẩu TRƯỚC khi chạm vào database.
 *
 * Thứ tự này quan trọng: `--account-name` tạo account thật. Đọc mật khẩu sau thì mật khẩu hỏng
 * (quá ngắn, nhập lại sai, stdin đứt) sẽ để lại một account rác không cách nào xoá qua giao diện.
 */
async function readValidPassword(app: ReturnType<typeof buildApplication>): Promise<string> {
  const password = await readPassword();
  // Luật mật khẩu đi qua composition root, không import thẳng module: entrypoint không được
  // biết module nào tồn tại (luật kiến trúc, ADR-0012).
  app.adminOps.assertPasswordAllowed(password);
  return password;
}

/**
 * `--role` bắt buộc, không có mặc định: tạo nhầm Super Admin là mở toàn bộ hệ thống, tạo nhầm `user`
 * là người đó không thấy gì — cả hai đều phải là lựa chọn có chủ đích.
 */
function parseRole<R extends string>(raw: string | undefined, allowed: readonly R[]): R {
  if (raw === undefined || !(allowed as readonly string[]).includes(raw)) throw new Error(`--role phải là ${allowed.join(' | ')}`);
  return raw as R;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`thiếu --${name}`);
  return value;
}

/**
 * Chọn account để gắn admin vào:
 *   --account <id>     dùng đúng id đó
 *   --account-name <n> tạo account mới
 *   không có cờ nào    chỉ chấp nhận khi hệ thống có ĐÚNG MỘT account
 *
 * Không tự đoán khi có nhiều account: gắn admin nhầm account là cấp quyền cho sai tổ chức.
 */
async function resolveAccount(app: ReturnType<typeof buildApplication>, flags: Map<string, string>): Promise<AccountId> {
  const ctx = { actor: { id: 'admin-cli', type: 'admin' as const }, source: 'system' as const };
  const explicit = flags.get('account');
  if (explicit !== undefined) return AccountId.parse(explicit);

  const name = flags.get('account-name');
  if (name !== undefined) {
    const created = await app.adminOps.createAccount.execute({ name }, ctx);
    process.stderr.write(`đã tạo account ${created.id} (${created.name})\n`);
    return AccountId.parse(created.id);
  }

  const accounts = await app.adminOps.listAccounts.execute();
  if (accounts.length === 1) return AccountId.parse(accounts[0]!.id);
  if (accounts.length === 0) throw new Error('chưa có account nào — thêm --account-name "<tên>" để tạo account đầu tiên');
  throw new Error(
    `có ${accounts.length} account, phải chọn rõ bằng --account <id>:\n` +
      accounts.map((a) => `  ${a.id}  ${a.name}`).join('\n'),
  );
}

/** Tách khỏi `main.ts` để test gọi được mà không khởi động process. */
export async function runAdminCli(env: Env, argv: readonly string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === undefined || command === 'help' || command === '--help') {
    process.stderr.write(`${USAGE}\n`);
    return command === undefined ? 1 : 0;
  }

  let container: Container | undefined;
  try {
    container = createContainer(env);
    const app = buildApplication(container);
    const ctx = { actor: { id: 'admin-cli', type: 'admin' as const }, source: 'system' as const };

    switch (command) {
      case 'list-accounts': {
        const accounts = await app.adminOps.listAccounts.execute();
        if (accounts.length === 0) process.stdout.write('(chưa có account nào)\n');
        for (const a of accounts) process.stdout.write(`${a.id}  ${a.name}\n`);
        return 0;
      }
      case 'create-admin': {
        const email = flags.get('email');
        if (email === undefined) throw new Error('thiếu --email');
        const role = parseRole(flags.get('role'), ADMIN_ROLES);
        const login = flags.get('login') ?? 'password';
        if (login !== 'password' && login !== 'm365') throw new Error('--login phải là password | m365');
        const password = login === 'm365' ? null : await readValidPassword(app);
        const accountId = await resolveAccount(app, flags);
        const admin = await app.adminOps.createAdmin.execute({ accountId, email, password, role }, ctx);
        process.stdout.write(
          `đã tạo admin ${admin.email} (${admin.role}) trong account ${admin.accountId}` +
            (password === null ? ' — chỉ đăng nhập bằng Microsoft 365\n' : '\n'),
        );
        return 0;
      }
      case 'reset-password': {
        const email = flags.get('email');
        if (email === undefined) throw new Error('thiếu --email');
        const password = await readValidPassword(app);
        const admin = await app.adminOps.setAdminPassword.execute({ email, password }, ctx);
        process.stdout.write(`đã đổi mật khẩu ${admin.email}; mọi phiên đang mở đã bị huỷ\n`);
        return 0;
      }
      case 'set-member': {
        const member = await app.adminOps.setOrgMember.execute(
          { orgId: OrgId.parse(required(flags, 'org')), email: required(flags, 'email'), role: parseRole(flags.get('role'), ORG_ROLES) },
          ctx,
        );
        process.stdout.write(`${member.email} là ${member.role} của org ${member.orgId}\n`);
        return 0;
      }
      case 'grant-app-role': {
        const granted = await app.adminOps.grantAppRole.execute(
          { appId: AppId.parse(required(flags, 'app')), email: required(flags, 'email'), role: parseRole(flags.get('role'), APP_ROLES) },
          ctx,
        );
        process.stdout.write(`${granted.email} là ${granted.role} của app ${granted.appId}\n`);
        return 0;
      }
      case 'scan-template-html': {
        // Chỉ đọc: không sửa template nào, không ghi audit. In ra để quyết định có bật kiểm cho kiểu html không.
        const { scanned, findings } = await app.adminOps.scanHtmlTemplates.execute();
        for (const f of findings) {
          process.stdout.write(`${f.appId}  ${f.templateId}  v${f.version} (${f.status})  ${f.name}\n`);
          for (const message of f.messages) process.stdout.write(`    - ${message}\n`);
        }
        process.stdout.write(`đã quét ${scanned} version kiểu html — ${findings.length} version sẽ bị chặn\n`);
        return 0;
      }
      default:
        throw new Error(`không có lệnh '${command}'\n\n${USAGE}`);
    }
  } catch (err) {
    process.stderr.write(`LỖI: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    await container?.dispose();
  }
}
