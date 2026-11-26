-- Guarda el oficio principal de cada persona del equipo tecnico.
alter table public.profiles
  add column if not exists specialty text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_specialty_allowed'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_specialty_allowed
      check (specialty is null or specialty in ('mechanical', 'bodywork', 'paint'));
  end if;
end;
$$;
