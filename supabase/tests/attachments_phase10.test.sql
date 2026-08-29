begin;
select plan(3);

select ok(exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload issue attachments'
), 'attachment upload policy exists');
select ok((select position('mimetype' in lower(coalesce(with_check, ''))) > 0 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload issue attachments'), 'Storage policy validates Supabase mimetype metadata');
select ok((select position('metadata is not null' in lower(coalesce(with_check, ''))) > 0 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload issue attachments'), 'missing Storage MIME metadata fails closed');

select * from finish();
rollback;
