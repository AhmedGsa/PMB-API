import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import pool from "./db";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export type Pagination = {
  page: number;
  pageSize: number;
  offset: number;
};

export type BookQuery = Pagination & {
  search?: string;
};

export type Book = {
  id: number;
  title: string | null;
  subtitle: string | null;
  parallelTitle: string | null;
  otherTitle: string | null;
  year: string | null;
  isbn: string | null;
  pages: string | null;
  edition: string | null;
  price: string | null;
  summary: string | null;
  contents: string | null;
  link: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  publicationDate: string | null;
  publisher: string | null;
  authors: string[];
};

export type PaginatedBooks = {
  data: Book[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  search: string | null;
};

type CountRow = RowDataPacket & { total: number };

type NoticeRow = RowDataPacket & Omit<Book, "authors">;

type AuthorRow = RowDataPacket & {
  noticeId: number;
  author_name: string | null;
  author_rejete: string | null;
  sortOrder: number;
};

export function parsePagination(query: Request["query"]): Pagination {
  const page = Math.max(1, parseInt(String(query.page ?? ""), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(String(query.pageSize ?? ""), 10) || DEFAULT_PAGE_SIZE)
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function parseSearch(query: Request["query"]): string | undefined {
  const raw = query.search ?? query.q;
  if (typeof raw !== "string") return undefined;
  const search = raw.trim();
  return search || undefined;
}

function likePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, "\\$&")}%`;
}

function searchFilter(search?: string): { sql: string; params: string[] } {
  if (!search) {
    return { sql: "", params: [] };
  }

  const like = likePattern(search);
  return {
    sql: `WHERE (
      n.tit1 LIKE ? ESCAPE '\\\\'
      OR n.tit2 LIKE ? ESCAPE '\\\\'
      OR n.tit3 LIKE ? ESCAPE '\\\\'
      OR n.tit4 LIKE ? ESCAPE '\\\\'
      OR n.code LIKE ? ESCAPE '\\\\'
      OR n.year LIKE ? ESCAPE '\\\\'
      OR p.ed_name LIKE ? ESCAPE '\\\\'
      OR EXISTS (
        SELECT 1
        FROM responsability r
        INNER JOIN authors a ON a.author_id = r.responsability_author
        WHERE r.responsability_notice = n.notice_id
          AND (
            a.author_name LIKE ? ESCAPE '\\\\'
            OR a.author_rejete LIKE ? ESCAPE '\\\\'
          )
      )
    )`,
    params: Array(9).fill(like),
  };
}

function formatAuthor(row: AuthorRow): string | null {
  const name = [row.author_name, row.author_rejete].filter(Boolean).join(", ");
  return name || null;
}

export async function getBooks({
  page,
  pageSize,
  offset,
  search,
}: BookQuery): Promise<PaginatedBooks> {
  const filter = searchFilter(search);

  const [countRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS total
     FROM notices n
     LEFT JOIN publishers p ON p.ed_id = n.ed1_id
     ${filter.sql}`,
    filter.params
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [notices] = await pool.query<NoticeRow[]>(
    `SELECT
       n.notice_id AS id,
       n.tit1 AS title,
       n.tit2 AS subtitle,
       n.tit3 AS parallelTitle,
       n.tit4 AS otherTitle,
       n.year,
       n.code AS isbn,
       n.npages AS pages,
       n.mention_edition AS edition,
       n.prix AS price,
       n.n_resume AS summary,
       n.n_contenu AS contents,
       n.lien AS link,
       n.create_date AS createdAt,
       n.update_date AS updatedAt,
       NULLIF(CAST(n.date_parution AS CHAR), '0000-00-00') AS publicationDate,
       p.ed_name AS publisher
     FROM notices n
     LEFT JOIN publishers p ON p.ed_id = n.ed1_id
     ${filter.sql}
     ORDER BY n.notice_id
     LIMIT ? OFFSET ?`,
    [...filter.params, pageSize, offset]
  );

  if (notices.length === 0) {
    return {
      data: [],
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
      search: search ?? null,
    };
  }

  const ids = notices.map((notice) => notice.id);
  const [authorRows] = await pool.query<AuthorRow[]>(
    `SELECT
       r.responsability_notice AS noticeId,
       a.author_name,
       a.author_rejete,
       r.responsability_ordre AS sortOrder
     FROM responsability r
     INNER JOIN authors a ON a.author_id = r.responsability_author
     WHERE r.responsability_notice IN (?)
     ORDER BY r.responsability_notice, r.responsability_ordre`,
    [ids]
  );

  const authorsByNotice = new Map<number, string[]>();
  for (const row of authorRows) {
    const author = formatAuthor(row);
    if (!author) continue;
    const authors = authorsByNotice.get(row.noticeId) ?? [];
    authors.push(author);
    authorsByNotice.set(row.noticeId, authors);
  }

  const data: Book[] = notices.map((notice) => ({
    id: notice.id,
    title: notice.title,
    subtitle: notice.subtitle,
    parallelTitle: notice.parallelTitle,
    otherTitle: notice.otherTitle,
    year: notice.year,
    isbn: notice.isbn,
    pages: notice.pages,
    edition: notice.edition,
    price: notice.price,
    summary: notice.summary,
    contents: notice.contents,
    link: notice.link,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    publicationDate: notice.publicationDate,
    publisher: notice.publisher,
    authors: authorsByNotice.get(notice.id) ?? [],
  }));

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 0,
    search: search ?? null,
  };
}
