export type ComposerImagePayload = {
  mime: "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;
};

export type ComposerDraft = {
  title: string;
  body: string;
  images: ComposerImagePayload[];
};

export type ComposerSubmission = {
  create: {
    title?: string;
    body?: string;
    provider?: string | null;
    model?: string | null;
    thinkingOptionId?: string | null;
  };
  images: ComposerImagePayload[];
};

export function prepareComposerSubmission(draft: ComposerDraft): ComposerSubmission | null {
  const title = draft.title.trim();
  const images = draft.images.slice(0, 3);
  if (!title && !draft.body.trim() && images.length === 0) return null;
  return {
    create: {
      ...(title ? { title } : {}),
      ...(draft.body ? { body: draft.body } : {}),
    },
    images,
  };
}
