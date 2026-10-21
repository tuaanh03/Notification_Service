import type { DescribeAdmins } from '../../../tenancy/application/index.ts';
import type { ActorDirectory } from '../../application/ports/index.ts';

/** audit -> tenancy (query công khai `DescribeAdmins`): email + tên của người làm, theo lô. */
export class TenancyActorDirectory implements ActorDirectory {
  private readonly describeAdmins: DescribeAdmins;

  constructor(deps: { describeAdmins: DescribeAdmins }) {
    this.describeAdmins = deps.describeAdmins;
  }

  async describe(ids: readonly string[]): Promise<Map<string, { email: string; displayName: string | null }>> {
    const admins = await this.describeAdmins.execute(ids);
    return new Map(admins.map((a) => [a.id as string, { email: a.email, displayName: a.displayName }]));
  }
}
