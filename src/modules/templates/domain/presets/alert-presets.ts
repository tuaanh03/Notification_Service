import type { TemplatePreset } from '../types/template-preset.ts';
import { button, divider, heading, note, presetDesign, row, text, variables } from './preset-design.ts';

export const INCIDENT_ALERT: TemplatePreset = {
  id: 'incident-alert',
  version: 1,
  category: 'alert',
  locales: {
    vi: {
      name: 'Cảnh báo sự cố',
      description: 'Báo ngay khi hệ thống gặp sự cố, kèm mức độ và link xem chi tiết.',
      subject: '[Sự cố] {{ payload.incident_title }}',
      design: presetDesign(
        row(heading('Phát hiện sự cố'), text('Hệ thống vừa ghi nhận một sự cố cần được xử lý.')),
        row(
          text('**Sự cố:** {{ payload.incident_title }}\n**Mức độ:** {{ payload.severity }}\n**Bắt đầu lúc:** {{ payload.started_at }}'),
          button('Xem chi tiết', '{{ payload.detail_url }}'),
        ),
        row(divider(), note('Chúng tôi sẽ gửi thông báo tiếp theo khi sự cố được khắc phục.')),
      ),
      schema: variables(
        ['incident_title', 'Mất kết nối cơ sở dữ liệu', 'Tên sự cố'],
        ['severity', 'Nghiêm trọng', 'Mức độ nghiêm trọng'],
        ['started_at', '19/10/2026 08:30', 'Thời điểm bắt đầu'],
        ['detail_url', 'https://status.example.com/incidents/123', 'Link chi tiết sự cố'],
      ),
    },
    en: {
      name: 'Incident alert',
      description: 'Notify people as soon as an incident occurs, with its severity and a link to details.',
      subject: '[Incident] {{ payload.incident_title }}',
      design: presetDesign(
        row(heading('Incident detected'), text('We have detected an incident that needs attention.')),
        row(
          text('**Incident:** {{ payload.incident_title }}\n**Severity:** {{ payload.severity }}\n**Started at:** {{ payload.started_at }}'),
          button('View details', '{{ payload.detail_url }}'),
        ),
        row(divider(), note('We will send another update once the incident is resolved.')),
      ),
      schema: variables(
        ['incident_title', 'Database connection lost', 'Incident title'],
        ['severity', 'Critical', 'Severity level'],
        ['started_at', 'Oct 19, 2026 08:30', 'Start time'],
        ['detail_url', 'https://status.example.com/incidents/123', 'Incident link'],
      ),
    },
  },
};

export const INCIDENT_RESOLVED: TemplatePreset = {
  id: 'incident-resolved',
  version: 1,
  category: 'alert',
  locales: {
    vi: {
      name: 'Sự cố đã khắc phục',
      description: 'Báo sự cố đã được xử lý xong, kèm thời điểm và tóm tắt.',
      subject: '[Đã khắc phục] {{ payload.incident_title }}',
      design: presetDesign(
        row(
          heading('Sự cố đã được khắc phục'),
          text('Sự cố **{{ payload.incident_title }}** đã được khắc phục lúc {{ payload.resolved_at }}. Hệ thống đã hoạt động bình thường.'),
        ),
        row(text('**Tóm tắt:** {{ payload.summary }}')),
        row(divider(), note('Cảm ơn bạn đã kiên nhẫn trong thời gian chúng tôi xử lý.')),
      ),
      schema: variables(
        ['incident_title', 'Mất kết nối cơ sở dữ liệu', 'Tên sự cố'],
        ['resolved_at', '19/10/2026 09:15', 'Thời điểm khắc phục'],
        ['summary', 'Đã khởi động lại máy chủ cơ sở dữ liệu và kiểm tra dữ liệu.', 'Tóm tắt sự cố'],
      ),
    },
    en: {
      name: 'Incident resolved',
      description: 'Let people know an incident has been fixed, with the time and a short summary.',
      subject: '[Resolved] {{ payload.incident_title }}',
      design: presetDesign(
        row(
          heading('Incident resolved'),
          text('The incident **{{ payload.incident_title }}** was resolved at {{ payload.resolved_at }}. All systems are back to normal.'),
        ),
        row(text('**Summary:** {{ payload.summary }}')),
        row(divider(), note('Thank you for your patience while we worked on this.')),
      ),
      schema: variables(
        ['incident_title', 'Database connection lost', 'Incident title'],
        ['resolved_at', 'Oct 19, 2026 09:15', 'Resolved at'],
        ['summary', 'We restarted the database server and verified the data.', 'Incident summary'],
      ),
    },
  },
};
