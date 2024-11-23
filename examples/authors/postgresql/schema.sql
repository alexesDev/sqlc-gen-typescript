create type author_status as enum ('draft', 'published', 'deleted');

CREATE TABLE authors (
  id   BIGSERIAL PRIMARY KEY,
  name text      NOT NULL,
  status author_status,
  required_status author_status not null default 'draft',
  bio  text
);
