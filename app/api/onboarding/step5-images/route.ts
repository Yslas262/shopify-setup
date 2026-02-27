import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ShopifyClient } from "@/lib/shopify";

const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id alt }
      userErrors { field message }
    }
  }
`;

const UPDATE_COLLECTION_IMAGE = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection { id }
      userErrors { field message }
    }
  }
`;

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

async function uploadToStaged(
  target: StagedTarget,
  file: File
): Promise<string> {
  const formData = new FormData();
  target.parameters.forEach((p) => formData.append(p.name, p.value));
  formData.append("file", file);

  const res = await fetch(target.url, { method: "POST", body: formData });
  if (!res.ok && res.status !== 201) {
    throw new Error(`Upload falhou: ${res.status}`);
  }

  return target.resourceUrl;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const client = new ShopifyClient(session.shop, session.accessToken);

    const logo = formData.get("logo") as File | null;
    const favicon = formData.get("favicon") as File | null;
    const bannerDesktop = formData.get("bannerDesktop") as File | null;
    const bannerMobile = formData.get("bannerMobile") as File | null;
    const collectionMeta = JSON.parse(
      (formData.get("collectionMeta") as string) || "[]"
    ) as { id: string; handle: string; name: string; imageIndex: number | null }[];

    const uploads: { key: string; file: File; mime: string }[] = [];
    if (logo)
      uploads.push({ key: "logo", file: logo, mime: logo.type });
    if (favicon)
      uploads.push({ key: "favicon", file: favicon, mime: favicon.type });
    if (bannerDesktop)
      uploads.push({
        key: "bannerDesktop",
        file: bannerDesktop,
        mime: bannerDesktop.type,
      });
    if (bannerMobile)
      uploads.push({
        key: "bannerMobile",
        file: bannerMobile,
        mime: bannerMobile.type,
      });

    collectionMeta.forEach((col) => {
      if (col.imageIndex !== null) {
        const colFile = formData.get(
          `collection_image_${col.imageIndex}`
        ) as File | null;
        if (colFile) {
          uploads.push({
            key: `col_${col.handle}`,
            file: colFile,
            mime: colFile.type,
          });
        }
      }
    });

    if (uploads.length === 0) {
      return NextResponse.json({
        success: true,
        logoUrl: "",
        faviconUrl: "",
        bannerDesktopUrl: "",
        bannerMobileUrl: "",
        collectionImages: [],
      });
    }

    const stagedInput = uploads.map((u) => ({
      filename: u.file.name,
      mimeType: u.mime,
      httpMethod: "POST" as const,
      resource: "IMAGE" as const,
    }));

    const stagedData = await client.graphqlWithRetry(STAGED_UPLOADS_CREATE, {
      input: stagedInput,
    });

    const stagedResult = stagedData as {
      stagedUploadsCreate: {
        stagedTargets: StagedTarget[];
        userErrors: { field: string; message: string }[];
      };
    };

    if (stagedResult.stagedUploadsCreate.userErrors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: stagedResult.stagedUploadsCreate.userErrors.map(
          (e) => e.message
        ),
      });
    }

    const targets = stagedResult.stagedUploadsCreate.stagedTargets;
    const urlMap: Record<string, string> = {};

    for (let i = 0; i < uploads.length; i++) {
      const resourceUrl = await uploadToStaged(targets[i], uploads[i].file);
      urlMap[uploads[i].key] = resourceUrl;
    }

    const fileCreateInputs = uploads.map((u) => ({
      originalSource: urlMap[u.key],
      contentType: "IMAGE" as const,
      alt: u.key,
    }));

    await client.graphqlWithRetry(FILE_CREATE, { files: fileCreateInputs });

    const collectionImages: { handle: string; url: string }[] = [];
    for (const col of collectionMeta) {
      const colUrl = urlMap[`col_${col.handle}`];
      if (colUrl && col.id) {
        try {
          await client.graphqlWithRetry(UPDATE_COLLECTION_IMAGE, {
            input: { id: col.id, image: { src: colUrl } },
          });
          collectionImages.push({ handle: col.handle, url: colUrl });
        } catch {
          collectionImages.push({ handle: col.handle, url: colUrl });
        }
      }
    }

    return NextResponse.json({
      success: true,
      logoUrl: urlMap["logo"] || "",
      faviconUrl: urlMap["favicon"] || "",
      bannerDesktopUrl: urlMap["bannerDesktop"] || "",
      bannerMobileUrl: urlMap["bannerMobile"] || "",
      collectionImages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json(
      { success: false, errors: [msg] },
      { status: 500 }
    );
  }
}
