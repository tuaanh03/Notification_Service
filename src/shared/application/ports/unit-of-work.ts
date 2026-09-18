/**
 * PORT: ranh giới transaction của một command. Không mang kiểu nào của hạ tầng — command không
 * biết Drizzle, MySQL hay "tx" tồn tại.
 *
 *   await uow.run(async () => {
 *     const app = await apps.load(id);        // repository tự dùng transaction đang mở
 *     app.apply('approve', clock.now());
 *     await apps.save(app);
 *     await outbox.append([appApproved(app)]); // cùng transaction với save
 *   });
 *
 * Mọi port được gọi BÊN TRONG `work` dùng chung một transaction: cùng commit hoặc cùng rollback.
 * `work` throw -> rollback toàn bộ, lỗi được ném lại nguyên vẹn.
 * Gọi `run` lồng nhau thì lần trong NHẬP vào transaction ngoài (không mở transaction mới).
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
