// Code generated by sqlc. DO NOT EDIT.

import { QueryArrayConfig, QueryArrayResult } from "pg";

interface Client {
    query: (config: QueryArrayConfig) => Promise<QueryArrayResult>;
}

export const getAuthorQuery = `-- name: GetAuthor :one
SELECT id, name, status, required_status, bio FROM authors
WHERE id = $1 LIMIT 1`;

export interface GetAuthorArgs {
    id: string;
}

export type PublicAuthorStatus = "draft" | "published" | "deleted";

export interface GetAuthorRow {
    id: string;
    name: string;
    status: PublicAuthorStatus | null;
    requiredStatus: PublicAuthorStatus;
    bio: string | null;
}

export async function getAuthor(client: Client, args: GetAuthorArgs): Promise<GetAuthorRow | null> {
    const result = await client.query({
        text: getAuthorQuery,
        values: [args.id],
        rowMode: "array"
    });
    if (result.rows.length !== 1) {
        return null;
    }
    const row = result.rows[0];
    return {
        id: row[0],
        name: row[1],
        status: row[2],
        requiredStatus: row[3],
        bio: row[4]
    };
}

export const listAuthorsQuery = `-- name: ListAuthors :many
SELECT id, name, status, required_status, bio FROM authors
ORDER BY name`;

export interface ListAuthorsRow {
    id: string;
    name: string;
    status: PublicAuthorStatus | null;
    requiredStatus: PublicAuthorStatus;
    bio: string | null;
}

export async function listAuthors(client: Client): Promise<ListAuthorsRow[]> {
    const result = await client.query({
        text: listAuthorsQuery,
        values: [],
        rowMode: "array"
    });
    return result.rows.map(row => {
        return {
            id: row[0],
            name: row[1],
            status: row[2],
            requiredStatus: row[3],
            bio: row[4]
        };
    });
}

export const createAuthorQuery = `-- name: CreateAuthor :one
INSERT INTO authors (
  name, bio, status, required_status
) VALUES (
  $1, $2, $3, $4
)
RETURNING id, name, status, required_status, bio`;

export interface CreateAuthorArgs {
    name: string;
    bio: string | null;
    status: string | null;
    requiredStatus: string;
}

export interface CreateAuthorRow {
    id: string;
    name: string;
    status: PublicAuthorStatus | null;
    requiredStatus: PublicAuthorStatus;
    bio: string | null;
}

export async function createAuthor(client: Client, args: CreateAuthorArgs): Promise<CreateAuthorRow | null> {
    const result = await client.query({
        text: createAuthorQuery,
        values: [args.name, args.bio, args.status, args.requiredStatus],
        rowMode: "array"
    });
    if (result.rows.length !== 1) {
        return null;
    }
    const row = result.rows[0];
    return {
        id: row[0],
        name: row[1],
        status: row[2],
        requiredStatus: row[3],
        bio: row[4]
    };
}

export const deleteAuthorQuery = `-- name: DeleteAuthor :exec
DELETE FROM authors
WHERE id = $1`;

export interface DeleteAuthorArgs {
    id: string;
}

export async function deleteAuthor(client: Client, args: DeleteAuthorArgs): Promise<void> {
    await client.query({
        text: deleteAuthorQuery,
        values: [args.id],
        rowMode: "array"
    });
}

export default function makeQueries(db: Parameters<typeof getAuthor>[0]) {
    return {
        getAuthor: (args: GetAuthorArgs) => getAuthor(db, args),
        listAuthors: () => listAuthors(db),
        createAuthor: (args: CreateAuthorArgs) => createAuthor(db, args),
        deleteAuthor: (args: DeleteAuthorArgs) => deleteAuthor(db, args)
    };
}

