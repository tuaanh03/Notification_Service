export const TEMPLATE_AGGREGATE = 'Template';

export const TEMPLATE_EVENTS = {
  created: 'TemplateCreated',
  renamed: 'TemplateRenamed',
  categoryChanged: 'TemplateCategoryChanged',
  draftSaved: 'TemplateDraftSaved',
  versionPublished: 'TemplateVersionPublished',
  archived: 'TemplateArchived',
  /** Xoá hẳn bằng admin-cli (dọn kiểu kéo-thả — ADR-0037); `before` giữ tên / app / version. */
  purged: 'TemplatePurged',
} as const;
