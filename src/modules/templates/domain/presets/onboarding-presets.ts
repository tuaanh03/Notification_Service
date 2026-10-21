import type { TemplatePreset } from '../types/template-preset.ts';
import { button, divider, heading, note, presetDesign, row, text, variables } from './preset-design.ts';

export const WELCOME: TemplatePreset = {
  id: 'welcome',
  version: 1,
  category: 'onboarding',
  locales: {
    vi: {
      name: 'Chào mừng',
      description: 'Chào người dùng mới và mời họ bắt đầu sử dụng.',
      subject: 'Chào mừng bạn đến với {{ payload.app_name }}',
      design: presetDesign(
        row(
          heading('Chào mừng, {{ payload.user_name }}!'),
          text('Cảm ơn bạn đã tham gia **{{ payload.app_name }}**. Tài khoản của bạn đã sẵn sàng.'),
          text('Hãy bắt đầu để khám phá các tính năng chính.'),
          button('Bắt đầu', '{{ payload.start_url }}'),
        ),
        row(divider(), note('Nếu cần hỗ trợ, hãy liên hệ bộ phận quản trị của bạn.')),
      ),
      schema: variables(
        ['user_name', 'Nguyễn Văn An', 'Tên người dùng'],
        ['app_name', 'Cổng nội bộ', 'Tên ứng dụng'],
        ['start_url', 'https://portal.example.com/start', 'Link bắt đầu'],
      ),
    },
    en: {
      name: 'Welcome',
      description: 'Greet new users and invite them to get started.',
      subject: 'Welcome to {{ payload.app_name }}',
      design: presetDesign(
        row(
          heading('Welcome, {{ payload.user_name }}!'),
          text('Thanks for joining **{{ payload.app_name }}**. Your account is ready.'),
          text('Get started to explore the main features.'),
          button('Get started', '{{ payload.start_url }}'),
        ),
        row(divider(), note('If you need help, please contact your administrator.')),
      ),
      schema: variables(
        ['user_name', 'Alex Nguyen', 'User name'],
        ['app_name', 'Internal Portal', 'App name'],
        ['start_url', 'https://portal.example.com/start', 'Start link'],
      ),
    },
  },
};

export const ACCOUNT_READY: TemplatePreset = {
  id: 'account-ready',
  version: 1,
  category: 'onboarding',
  locales: {
    vi: {
      name: 'Cấp tài khoản',
      description: 'Báo tài khoản đã được tạo, kèm tên đăng nhập và link đăng nhập.',
      subject: 'Tài khoản của bạn đã được tạo',
      design: presetDesign(
        row(
          heading('Tài khoản đã sẵn sàng'),
          text('Xin chào {{ payload.user_name }}, tài khoản của bạn đã được cấp.'),
          text('**Tên đăng nhập:** {{ payload.username }}'),
          button('Đăng nhập', '{{ payload.login_url }}'),
        ),
        row(divider(), note('Vì lý do bảo mật, đừng chia sẻ thông tin đăng nhập với người khác.')),
      ),
      schema: variables(
        ['user_name', 'Nguyễn Văn An', 'Tên người dùng'],
        ['username', 'an.nguyen', 'Tên đăng nhập'],
        ['login_url', 'https://portal.example.com/login', 'Link đăng nhập'],
      ),
    },
    en: {
      name: 'Account created',
      description: 'Tell users their account is ready, with their username and a sign-in link.',
      subject: 'Your account has been created',
      design: presetDesign(
        row(
          heading('Your account is ready'),
          text('Hi {{ payload.user_name }}, an account has been created for you.'),
          text('**Username:** {{ payload.username }}'),
          button('Sign in', '{{ payload.login_url }}'),
        ),
        row(divider(), note('For your security, do not share your sign-in details with anyone.')),
      ),
      schema: variables(
        ['user_name', 'Alex Nguyen', 'User name'],
        ['username', 'alex.nguyen', 'Username'],
        ['login_url', 'https://portal.example.com/login', 'Sign-in link'],
      ),
    },
  },
};
