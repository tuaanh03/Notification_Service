import { checkEmailHtml } from '../../domain/rules/email-html.ts';
import type { TemplateRepository } from '../ports/index.ts';

export interface HtmlScanFinding {
  appId: string;
  templateId: string;
  name: string;
  version: number;
  status: string;
  /** Mã lỗi `checkEmailHtml` (không lặp) — rỗng = sẽ qua nếu bật kiểm cho kiểu `html`. */
  codes: string[];
  messages: string[];
}

/**
 * CHẠY THỬ bộ kiểm an toàn (ADR-0036) trên MỌI version kiểu `html` — chỉ đọc, không ghi gì. Để biết bật
 * kiểm cho kiểu `html` thì template nào sẽ bị chặn lúc lưu, trước khi quyết định bật. Chỉ admin-cli gọi.
 */
export class ScanHtmlTemplates {
  private readonly deps: { templates: TemplateRepository };

  constructor(deps: ScanHtmlTemplates['deps']) {
    this.deps = deps;
  }

  async execute(): Promise<{ scanned: number; findings: HtmlScanFinding[] }> {
    const rows = await this.deps.templates.versionsByEditor('html');
    const findings: HtmlScanFinding[] = [];
    for (const { template, version } of rows) {
      if (!version.html.trim()) continue;
      const issues = checkEmailHtml(version.html);
      if (issues.length === 0) continue;
      findings.push({
        appId: template.appId,
        templateId: template.id,
        name: template.name,
        version: version.version,
        status: version.status,
        codes: [...new Set(issues.map((i) => i.code))],
        messages: issues.map((i) => i.message),
      });
    }
    return { scanned: rows.length, findings };
  }
}
