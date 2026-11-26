-- Modela prerequisitos operativos independientes del orden en que se registran.
create table if not exists public.work_order_task_dependencies (
  task_id uuid not null references public.work_order_tasks(id) on delete cascade,
  prerequisite_task_id uuid not null references public.work_order_tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, prerequisite_task_id),
  constraint work_order_task_dependency_not_self check (task_id <> prerequisite_task_id)
);

create index if not exists work_order_task_dependencies_prerequisite_idx
  on public.work_order_task_dependencies (prerequisite_task_id);

alter table public.work_order_task_dependencies enable row level security;
revoke all on public.work_order_task_dependencies from anon;
grant select, insert, delete on public.work_order_task_dependencies to authenticated;

drop policy if exists task_dependencies_management_all on public.work_order_task_dependencies;
create policy task_dependencies_management_all on public.work_order_task_dependencies
  for all to authenticated
  using (public.current_app_role() in ('owner', 'advisor'))
  with check (public.current_app_role() in ('owner', 'advisor'));

drop policy if exists task_dependencies_assigned_technician_read on public.work_order_task_dependencies;
create policy task_dependencies_assigned_technician_read on public.work_order_task_dependencies
  for select to authenticated
  using (exists (
    select 1 from public.work_order_tasks t
    where t.id = task_id and t.assigned_to = (select auth.uid())
  ));

create or replace function public.validate_work_order_task_dependency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_order_id uuid;
  prerequisite_order_id uuid;
begin
  select work_order_id into task_order_id from public.work_order_tasks where id = new.task_id;
  select work_order_id into prerequisite_order_id from public.work_order_tasks where id = new.prerequisite_task_id;
  if task_order_id is null or prerequisite_order_id is null or task_order_id <> prerequisite_order_id then
    raise exception 'Los prerequisitos deben pertenecer a la misma orden de trabajo.' using errcode = '23514';
  end if;

  if exists (
    with recursive prerequisite_chain(task_id) as (
      select prerequisite_task_id
      from public.work_order_task_dependencies
      where task_id = new.prerequisite_task_id
      union
      select d.prerequisite_task_id
      from public.work_order_task_dependencies d
      join prerequisite_chain chain on d.task_id = chain.task_id
    )
    select 1 from prerequisite_chain where task_id = new.task_id
  ) then
    raise exception 'Este prerequisito crearía un ciclo entre tareas.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_work_order_task_dependency() from public, anon, authenticated;
drop trigger if exists work_order_task_dependency_validate on public.work_order_task_dependencies;
create trigger work_order_task_dependency_validate
  before insert or update on public.work_order_task_dependencies
  for each row execute function public.validate_work_order_task_dependency();

create or replace function public.guard_work_order_task_prerequisites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  unfinished_title text;
begin
  if new.status in ('in_progress', 'done') and old.status is distinct from new.status then
    select prerequisite.title into unfinished_title
    from public.work_order_task_dependencies dependency
    join public.work_order_tasks prerequisite on prerequisite.id = dependency.prerequisite_task_id
    where dependency.task_id = new.id and prerequisite.status <> 'done'
    order by prerequisite.created_at
    limit 1;
    if unfinished_title is not null then
      raise exception 'No puedes iniciar ni terminar esta tarea todavía. Primero debe completarse: %.', unfinished_title
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_work_order_task_prerequisites() from public, anon, authenticated;
drop trigger if exists work_order_task_prerequisites_guard on public.work_order_tasks;
create trigger work_order_task_prerequisites_guard
  before update of status on public.work_order_tasks
  for each row execute function public.guard_work_order_task_prerequisites();

-- Da al técnico asignado el estado y nombre de los prerequisitos de sus tareas,
-- sin abrirle la lectura de las tareas asignadas a otros integrantes.
create or replace function public.app_task_prerequisite_status(p_task_ids uuid[])
returns table (
  task_id uuid,
  prerequisite_task_id uuid,
  prerequisite_title text,
  prerequisite_status public.task_status
)
language sql
stable
security definer
set search_path = public
as $$
  select dependency.task_id, prerequisite.id, prerequisite.title, prerequisite.status
  from public.work_order_task_dependencies dependency
  join public.work_order_tasks assigned_task on assigned_task.id = dependency.task_id
  join public.work_order_tasks prerequisite on prerequisite.id = dependency.prerequisite_task_id
  where public.current_app_role() = 'technician'
    and assigned_task.assigned_to = (select auth.uid())
    and dependency.task_id = any(coalesce(p_task_ids, array[]::uuid[]));
$$;

revoke all on function public.app_task_prerequisite_status(uuid[]) from public, anon;
grant execute on function public.app_task_prerequisite_status(uuid[]) to authenticated;
