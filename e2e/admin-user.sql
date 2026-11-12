insert into auth.users (email) values ('admin@example.com');
insert into admin_users select id from auth.users where email = 'admin@example.com';
