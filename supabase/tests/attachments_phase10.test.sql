begin;
select plan(3);

select has_policy('storage', 'objects', 'Members can upload issue attachments', 'attachment upload policy exists');
select ok((select with_check like '%metadata->>''mimetype''%' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload issue attachments'), 'Storage policy validates Supabase mimetype metadata');
select ok((select with_check like '%metadata is not null%' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Members can upload issue attachments'), 'missing Storage MIME metadata fails closed');

select * from finish();
rollback;
