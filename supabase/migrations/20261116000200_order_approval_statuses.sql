-- Separa la aprobación completa y parcial como estados reales de la orden.
-- Ejecutar este archivo antes de 20261116000300_sync_order_approval_statuses.sql.
alter type public.work_order_status add value if not exists 'approved';
alter type public.work_order_status add value if not exists 'partially_approved';
