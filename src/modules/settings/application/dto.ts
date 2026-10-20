/** Một cài đặt trên màn Cài đặt hệ thống. `value` = giá trị hiệu lực (đã gộp mặc định). */
export interface SystemSettingDto {
  key: string;
  /** int | url | bool */
  kind: string;
  value: number | string | boolean | null;
  default: number | string | boolean | null;
  min: number | null;
  max: number | null;
  /** false = đang dùng mặc định (chưa ai chỉnh). */
  customized: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}
