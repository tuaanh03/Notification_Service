import type { TemplatePreset } from '../types/template-preset.ts';
import { button, divider, heading, note, presetDesign, row, text, variables } from './preset-design.ts';

export const APPROVAL_REQUEST: TemplatePreset = {
  id: 'approval-request',
  version: 1,
  category: 'approval',
  locales: {
    vi: {
      name: 'Có yêu cầu chờ duyệt',
      description: 'Báo người duyệt khi có yêu cầu mới đang chờ họ xem xét.',
      subject: 'Yêu cầu chờ duyệt: {{ payload.request_title }}',
      design: presetDesign(
        row(
          heading('Có yêu cầu chờ bạn duyệt'),
          text('**{{ payload.requester }}** vừa gửi yêu cầu **{{ payload.request_title }}** và đang chờ bạn xem xét.'),
          button('Xem và duyệt', '{{ payload.approve_url }}'),
        ),
        row(divider(), note('Yêu cầu sẽ chờ cho tới khi bạn duyệt hoặc từ chối.')),
      ),
      schema: variables(
        ['requester', 'Trần Thị Bình', 'Người gửi yêu cầu'],
        ['request_title', 'Đề nghị mua thiết bị', 'Tên yêu cầu'],
        ['approve_url', 'https://work.example.com/requests/88', 'Link duyệt'],
      ),
    },
    en: {
      name: 'Approval request',
      description: 'Notify approvers when a new request is waiting for their review.',
      subject: 'Approval needed: {{ payload.request_title }}',
      design: presetDesign(
        row(
          heading('A request is waiting for your approval'),
          text('**{{ payload.requester }}** submitted **{{ payload.request_title }}** and is waiting for your review.'),
          button('Review request', '{{ payload.approve_url }}'),
        ),
        row(divider(), note('The request stays pending until you approve or reject it.')),
      ),
      schema: variables(
        ['requester', 'Binh Tran', 'Requester'],
        ['request_title', 'Equipment purchase request', 'Request title'],
        ['approve_url', 'https://work.example.com/requests/88', 'Review link'],
      ),
    },
  },
};

export const APPROVAL_RESULT: TemplatePreset = {
  id: 'approval-result',
  version: 1,
  category: 'approval',
  locales: {
    vi: {
      name: 'Kết quả duyệt',
      description: 'Báo người gửi biết yêu cầu đã được duyệt hay từ chối.',
      subject: 'Kết quả duyệt: {{ payload.request_title }}',
      design: presetDesign(
        row(heading('Yêu cầu đã có kết quả'), text('Yêu cầu **{{ payload.request_title }}** của bạn đã được xử lý.')),
        row(text('**Kết quả:** {{ payload.result }}\n**Ghi chú:** {{ payload.note }}')),
        row(divider(), note('Nếu có thắc mắc, hãy liên hệ người duyệt.')),
      ),
      schema: variables(
        ['request_title', 'Đề nghị mua thiết bị', 'Tên yêu cầu'],
        ['result', 'Đã duyệt', 'Kết quả duyệt'],
        ['note', 'Vui lòng gửi hoá đơn sau khi mua.', 'Ghi chú người duyệt'],
      ),
    },
    en: {
      name: 'Approval result',
      description: 'Let the requester know whether their request was approved or rejected.',
      subject: 'Decision on your request: {{ payload.request_title }}',
      design: presetDesign(
        row(heading('Your request has a decision'), text('Your request **{{ payload.request_title }}** has been reviewed.')),
        row(text('**Result:** {{ payload.result }}\n**Note:** {{ payload.note }}')),
        row(divider(), note('If you have any questions, please contact the approver.')),
      ),
      schema: variables(
        ['request_title', 'Equipment purchase request', 'Request title'],
        ['result', 'Approved', 'Review result'],
        ['note', 'Please send the invoice after purchase.', 'Approver note'],
      ),
    },
  },
};
