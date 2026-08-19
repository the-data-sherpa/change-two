import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { APIRoute, GetStaticPaths } from "astro";

import { loadPublications, type Publication } from "../../../lib/publications.js";

interface Props {
  readonly file: string;
  readonly publication: Publication;
}

export const getStaticPaths: GetStaticPaths = () => loadPublications().flatMap((publication) =>
  publication.rawFiles.map((file) => ({
    params: { file: file.path, revision: publication.revisionSlug },
    props: { file: file.path, publication } satisfies Props,
  })),
);

export const GET: APIRoute<Props> = ({ props }) => {
  const rawFile = props.publication.rawFiles.find((candidate) => candidate.path === props.file);
  if (rawFile === undefined) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(readFileSync(join(props.publication.bundleDirectory, rawFile.path))), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": rawFile.mediaType,
      "x-content-type-options": "nosniff",
    },
  });
};
