import type { TemplatePreset } from '../types/template-preset.ts';
import { button, heading, note, PANEL, presetDesign, row, text, variables } from './preset-design.ts';

/** Hàng 2 cột số liệu — màn hẹp tự xếp chồng. */
const metrics = (label1: string, label2: string) => ({
  backgroundColor: PANEL,
  columns: [
    [heading('{{ payload.metric_1 }}', 2, 'center'), note(label1, 'center')],
    [heading('{{ payload.metric_2 }}', 2, 'center'), note(label2, 'center')],
  ],
});

export const PERIODIC_REPORT: TemplatePreset = {
  id: 'periodic-report',
  version: 1,
  category: 'report',
  locales: {
    vi: {
      name: 'Báo cáo định kỳ',
      description: 'Gửi số liệu tóm tắt theo kỳ, kèm link xem báo cáo đầy đủ.',
      subject: 'Báo cáo {{ payload.period }}',
      design: presetDesign(
        row(heading('Báo cáo {{ payload.period }}'), text('Dưới đây là số liệu tóm tắt của kỳ này.')),
        metrics('Tổng số', 'Hoàn thành'),
        row(button('Xem báo cáo đầy đủ', '{{ payload.report_url }}')),
      ),
      schema: variables(
        ['period', 'tháng 10/2026', 'Kỳ báo cáo'],
        ['metric_1', '1.250', 'Tổng số'],
        ['metric_2', '1.180', 'Hoàn thành'],
        ['report_url', 'https://reports.example.com/2026-10', 'Link báo cáo'],
      ),
    },
    en: {
      name: 'Periodic report',
      description: 'Send a short summary of key numbers for the period, with a link to the full report.',
      subject: 'Report for {{ payload.period }}',
      design: presetDesign(
        row(heading('Report for {{ payload.period }}'), text('Here is a summary of the key numbers for this period.')),
        metrics('Total', 'Completed'),
        row(button('View full report', '{{ payload.report_url }}')),
      ),
      schema: variables(
        ['period', 'October 2026', 'Reporting period'],
        ['metric_1', '1,250', 'Total'],
        ['metric_2', '1,180', 'Completed'],
        ['report_url', 'https://reports.example.com/2026-10', 'Report link'],
      ),
    },
  },
};
