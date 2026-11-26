-- Asocia las tareas ejecutables con el concepto aprobado que las originó.
alter type public.task_status add value if not exists 'paused';

alter table public.work_order_tasks
  add column if not exists estimate_item_id uuid references public.estimate_items(id) on delete set null,
  add column if not exists total_seconds integer not null default 0 check (total_seconds >= 0),
  add column if not exists active_started_at timestamptz;

create index if not exists work_order_tasks_estimate_item_idx
  on public.work_order_tasks (estimate_item_id);
