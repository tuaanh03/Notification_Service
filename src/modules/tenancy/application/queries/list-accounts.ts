import { toAccountDto, type AccountDto } from '../dto.ts';
import type { AccountRepository } from '../ports/index.ts';

/**
 * Liệt kê account. CHỈ dùng cho CLI (`entrypoints/admin-cli`) — tạo admin phải gắn vào một
 * account, mà người dựng máy chủ mới không có cách nào biết id đó trước.
 *
 * Cố ý không có route HTTP: danh sách account là thứ vượt ra ngoài ranh giới của một tổ chức.
 */
export class ListAccounts {
  private readonly accounts: AccountRepository;

  constructor(deps: { accounts: AccountRepository }) {
    this.accounts = deps.accounts;
  }

  async execute(): Promise<AccountDto[]> {
    return (await this.accounts.listAll()).map(toAccountDto);
  }
}
