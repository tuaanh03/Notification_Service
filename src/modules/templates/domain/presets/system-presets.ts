import type { TemplatePreset } from '../types/template-preset.ts';
import { button, divider, heading, note, presetDesign, row, text, variables } from './preset-design.ts';

export const NEW_DEVICE_SIGN_IN: TemplatePreset = {
  id: 'new-device-sign-in',
  version: 1,
  category: 'system',
  locales: {
    vi: {
      name: 'Đăng nhập từ thiết bị lạ',
      description: 'Báo người dùng khi tài khoản được đăng nhập từ một thiết bị mới.',
      subject: 'Tài khoản của bạn vừa đăng nhập từ thiết bị lạ',
      design: presetDesign(
        row(
          heading('Có đăng nhập từ thiết bị lạ'),
          text('Xin chào {{ payload.user_name }}, tài khoản của bạn vừa được đăng nhập từ một thiết bị chưa từng dùng.'),
        ),
        row(
          text('**Thiết bị:** {{ payload.device }}\n**Vị trí:** {{ payload.location }}\n**Thời gian:** {{ payload.time }}'),
          text('Nếu đó là bạn, bạn không cần làm gì thêm. Nếu không phải, hãy kiểm tra và bảo vệ tài khoản ngay.'),
          button('Kiểm tra hoạt động', '{{ payload.review_url }}'),
        ),
        row(divider(), note('Thư này được gửi tự động để bảo vệ tài khoản của bạn.')),
      ),
      schema: variables(
        ['user_name', 'Nguyễn Văn An', 'Tên người dùng'],
        ['device', 'Chrome trên Windows', 'Thiết bị / trình duyệt'],
        ['location', 'Hà Nội, Việt Nam', 'Vị trí ước tính'],
        ['time', '19/10/2026 21:04', 'Thời điểm đăng nhập'],
        ['review_url', 'https://account.example.com/security', 'Link trang kiểm tra hoạt động (https://)'],
      ),
    },
    en: {
      name: 'Sign-in from a new device',
      description: 'Tell users when their account is signed in from a device they have not used before.',
      subject: 'New sign-in to your account from an unknown device',
      design: presetDesign(
        row(
          heading('New sign-in from an unknown device'),
          text('Hi {{ payload.user_name }}, your account was just signed in from a device you have not used before.'),
        ),
        row(
          text('**Device:** {{ payload.device }}\n**Location:** {{ payload.location }}\n**Time:** {{ payload.time }}'),
          text('If this was you, there is nothing else to do. If not, please review and secure your account right away.'),
          button('Review activity', '{{ payload.review_url }}'),
        ),
        row(divider(), note('This message was sent automatically to help keep your account safe.')),
      ),
      schema: variables(
        ['user_name', 'Alex Nguyen', 'User name'],
        ['device', 'Chrome on Windows', 'Device / browser'],
        ['location', 'Hanoi, Vietnam', 'Approximate location'],
        ['time', 'Oct 19, 2026 21:04', 'Sign-in time'],
        ['review_url', 'https://account.example.com/security', 'Link to the activity page (https://)'],
      ),
    },
  },
};

export const MAINTENANCE_NOTICE: TemplatePreset = {
  id: 'maintenance-notice',
  version: 1,
  category: 'system',
  locales: {
    vi: {
      name: 'Lịch bảo trì',
      description: 'Báo trước lịch bảo trì hệ thống và mức ảnh hưởng.',
      subject: 'Lịch bảo trì hệ thống: {{ payload.start_at }}',
      design: presetDesign(
        row(heading('Thông báo bảo trì'), text('Hệ thống sẽ được bảo trì theo lịch dưới đây.')),
        row(text('**Bắt đầu:** {{ payload.start_at }}\n**Kết thúc:** {{ payload.end_at }}\n**Ảnh hưởng:** {{ payload.impact }}')),
        row(divider(), note('Xin lỗi vì sự bất tiện. Cảm ơn bạn đã thông cảm.')),
      ),
      schema: variables(
        ['start_at', '25/10/2026 22:00', 'Thời điểm bắt đầu'],
        ['end_at', '26/10/2026 02:00', 'Thời điểm kết thúc dự kiến'],
        ['impact', 'Không truy cập được cổng thông tin trong thời gian bảo trì.', 'Dịch vụ nào bị ảnh hưởng'],
      ),
    },
    en: {
      name: 'Scheduled maintenance',
      description: 'Announce upcoming system maintenance and what it affects.',
      subject: 'Scheduled maintenance: {{ payload.start_at }}',
      design: presetDesign(
        row(heading('Scheduled maintenance'), text('Our systems will be under maintenance during the window below.')),
        row(text('**Starts:** {{ payload.start_at }}\n**Ends:** {{ payload.end_at }}\n**Impact:** {{ payload.impact }}')),
        row(divider(), note('We apologize for any inconvenience and thank you for your understanding.')),
      ),
      schema: variables(
        ['start_at', 'Oct 25, 2026 22:00', 'Start time'],
        ['end_at', 'Oct 26, 2026 02:00', 'Expected end time'],
        ['impact', 'The portal will be unavailable during maintenance.', 'Which services are affected'],
      ),
    },
  },
};

export const PASSWORD_RESET: TemplatePreset = {
  id: 'password-reset',
  version: 1,
  category: 'system',
  locales: {
    vi: {
      name: 'Đặt lại mật khẩu',
      description: 'Gửi link đặt lại mật khẩu khi người dùng yêu cầu.',
      subject: 'Đặt lại mật khẩu của bạn',
      design: presetDesign(
        row(
          heading('Đặt lại mật khẩu'),
          text('Xin chào {{ payload.user_name }}, chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.'),
          button('Đặt lại mật khẩu', '{{ payload.reset_url }}'),
        ),
        row(
          divider(),
          note('Link có hiệu lực trong {{ payload.expires_in }}. Nếu bạn không yêu cầu, hãy bỏ qua thư này — mật khẩu của bạn không thay đổi.'),
        ),
      ),
      schema: variables(
        ['user_name', 'Nguyễn Văn An', 'Tên người dùng'],
        ['reset_url', 'https://account.example.com/reset?token=abc', 'Link đặt lại mật khẩu (https://)'],
        ['expires_in', '30 phút', 'Thời hạn của link'],
      ),
    },
    en: {
      name: 'Password reset',
      description: 'Send a password reset link when a user asks for one.',
      subject: 'Reset your password',
      design: presetDesign(
        row(
          heading('Reset your password'),
          text('Hi {{ payload.user_name }}, we received a request to reset the password for your account.'),
          button('Reset password', '{{ payload.reset_url }}'),
        ),
        row(
          divider(),
          note('This link expires in {{ payload.expires_in }}. If you did not ask for this, you can ignore this email — your password will not change.'),
        ),
      ),
      schema: variables(
        ['user_name', 'Alex Nguyen', 'User name'],
        ['reset_url', 'https://account.example.com/reset?token=abc', 'Password reset link (https://)'],
        ['expires_in', '30 minutes', 'How long the link is valid'],
      ),
    },
  },
};
