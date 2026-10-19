import type { TemplatePreset } from '../types/template-preset.ts';
import { button, divider, heading, note, presetDesign, row, text, variables } from './preset-design.ts';

export const TASK_DUE_REMINDER: TemplatePreset = {
  id: 'task-due-reminder',
  version: 1,
  category: 'reminder',
  locales: {
    vi: {
      name: 'Nhắc hạn công việc',
      description: 'Nhắc người phụ trách khi một công việc sắp đến hạn.',
      subject: 'Nhắc việc: {{ payload.task_name }} sắp đến hạn',
      design: presetDesign(
        row(
          heading('Công việc sắp đến hạn'),
          text('Công việc **{{ payload.task_name }}** cần hoàn thành trước **{{ payload.due_at }}**.'),
          button('Mở công việc', '{{ payload.task_url }}'),
        ),
        row(divider(), note('Nếu bạn đã hoàn thành, hãy bỏ qua thư này.')),
      ),
      schema: variables(
        ['task_name', 'Duyệt báo cáo quý 3', 'Tên công việc'],
        ['due_at', '17:00 ngày 20/10/2026', 'Hạn hoàn thành'],
        ['task_url', 'https://work.example.com/tasks/42', 'Link mở công việc (https://)'],
      ),
    },
    en: {
      name: 'Task due reminder',
      description: 'Remind the owner when a task is about to be due.',
      subject: 'Reminder: {{ payload.task_name }} is due soon',
      design: presetDesign(
        row(
          heading('Task due soon'),
          text('The task **{{ payload.task_name }}** is due by **{{ payload.due_at }}**.'),
          button('Open task', '{{ payload.task_url }}'),
        ),
        row(divider(), note('If you have already finished it, you can ignore this email.')),
      ),
      schema: variables(
        ['task_name', 'Review Q3 report', 'Task name'],
        ['due_at', 'Oct 20, 2026 17:00', 'Due date'],
        ['task_url', 'https://work.example.com/tasks/42', 'Link to the task (https://)'],
      ),
    },
  },
};

export const MEETING_REMINDER: TemplatePreset = {
  id: 'meeting-reminder',
  version: 1,
  category: 'reminder',
  locales: {
    vi: {
      name: 'Nhắc lịch họp',
      description: 'Nhắc người tham dự trước giờ họp, kèm thời gian, địa điểm và link tham gia.',
      subject: 'Nhắc lịch họp: {{ payload.meeting_title }}',
      design: presetDesign(
        row(heading('Sắp đến giờ họp'), text('Bạn có một cuộc họp sắp diễn ra.')),
        row(
          text('**Cuộc họp:** {{ payload.meeting_title }}\n**Thời gian:** {{ payload.start_at }}\n**Địa điểm:** {{ payload.location }}'),
          button('Tham gia cuộc họp', '{{ payload.join_url }}'),
        ),
      ),
      schema: variables(
        ['meeting_title', 'Họp giao ban tuần', 'Tên cuộc họp'],
        ['start_at', '09:00 ngày 21/10/2026', 'Thời gian bắt đầu'],
        ['location', 'Phòng họp tầng 3', 'Địa điểm'],
        ['join_url', 'https://meet.example.com/abc-123', 'Link tham gia trực tuyến (https://)'],
      ),
    },
    en: {
      name: 'Meeting reminder',
      description: 'Remind attendees before a meeting, with the time, place and join link.',
      subject: 'Meeting reminder: {{ payload.meeting_title }}',
      design: presetDesign(
        row(heading('Your meeting starts soon'), text('You have an upcoming meeting.')),
        row(
          text('**Meeting:** {{ payload.meeting_title }}\n**Time:** {{ payload.start_at }}\n**Location:** {{ payload.location }}'),
          button('Join meeting', '{{ payload.join_url }}'),
        ),
      ),
      schema: variables(
        ['meeting_title', 'Weekly team meeting', 'Meeting title'],
        ['start_at', 'Oct 21, 2026 09:00', 'Start time'],
        ['location', 'Meeting room, 3rd floor', 'Location'],
        ['join_url', 'https://meet.example.com/abc-123', 'Online join link (https://)'],
      ),
    },
  },
};
