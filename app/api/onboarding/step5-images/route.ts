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

interface UploadItem {
  key: string;
  file: File;
  mime: string;
}

async function uploadSingleImage(
  client: ShopifyClient,
  item: UploadItem
): Promise<{ key: string; url: string } | null> {
  try {
    const stagedData = await client.graphqlWithRetry(STAGED_UPLOADS_CREATE, {
      input: [
        {
          filename: item.file.name,
          mimeType: item.mime,
          httpMethod: "POST" as const,
          resource: "IMAGE" as const,
        },
      ],
    });

    const result = stagedData as {
      stagedUploadsCreate: {
        stagedTargets: StagedTarget[];
        userErrors: { field: string; message: string }[];
      };
    };

    if (result.stagedUploadsCreate.userErrors.length > 0) {
      console.error(`[step5] stagedUpload erro para ${item.key}:`, result.stagedUploadsCreate.userErrors);
      return null;
    }

    const target = result.stagedUploadsCreate.stagedTargets[0];
    if (!target) return null;

    const formData = new FormData();
    target.parameters.forEach((p) => formData.append(p.name, p.value));
    formData.append("file", item.file);

    const uploadRes = await fetch(target.url, { method: "POST", body: formData });
    if (!uploadRes.ok && uploadRes.status !== 201) {
      console.error(`[step5] Upload S3 falhou para ${item.key}: ${uploadRes.status}`);
      return null;
    }

    await client.graphqlWithRetry(FILE_CREATE, {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: "IMAGE" as const,
          alt: item.key,
        },
      ],
    });

    return { key: item.key, url: target.resourceUrl };
  } catch (err) {
    console.error(`[step5] Exceção ao processar ${item.key}:`, err);
    return null;
  }
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

    const uploads: UploadItem[] = [];
    if (logo) uploads.push({ key: "logo", file: logo, mime: logo.type });
    if (favicon) uploads.push({ key: "favicon", file: favicon, mime: favicon.type });
    if (bannerDesktop) uploads.push({ key: "bannerDesktop", file: bannerDesktop, mime: bannerDesktop.type });
    if (bannerMobile) uploads.push({ key: "bannerMobile", file: bannerMobile, mime: bannerMobile.type });

    collectionMeta.forEach((col) => {
      if (col.imageIndex !== null) {
        const f = formData.get(`collection_image_${col.imageIndex}`) as File | null;
        if (f) uploads.push({ key: `col_${col.handle}`, file: f, mime: f.type });
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
        uploaded: 0,
        failed: 0,
        errors: [],
        message: "Nenhuma imagem para processar.",
      });
    }

    const urlMap: Record<string, string> = {};
    const errors: { key: string; reason: string }[] = [];

    for (const item of uploads) {
      const result = await uploadSingleImage(client, item);
      if (result) {
        urlMap[result.key] = result.url;
      } else {
        errors.push({ key: item.key, reason: "Falha no upload" });
      }
    }

    const collectionImages: { handle: string; url: string }[] = [];
    for (const col of collectionMeta) {
      const colUrl = urlMap[`col_${col.handle}`];
      if (colUrl && col.id) {
        try {
          await client.graphqlWithRetry(UPDATE_COLLECTION_IMAGE, {
            input: { id: col.id, image: { src: colUrl } },
          });
        } catch (err) {
          console.error(`[step5] Erro ao vincular imagem da coleção ${col.handle}:`, err);
        }
        collectionImages.push({ handle: col.handle, url: colUrl });
      }
    }

    const uploaded = Object.keys(urlMap).length;

    return NextResponse.json({
      success: uploaded > 0 || uploads.length === 0,
      logoUrl: urlMap["logo"] || "",
      faviconUrl: urlMap["favicon"] || "",
      bannerDesktopUrl: urlMap["bannerDesktop"] || "",
      bannerMobileUrl: urlMap["bannerMobile"] || "",
      collectionImages,
      uploaded,
      failed: errors.length,
      errors,
      message:
        errors.length === 0
          ? `${uploaded} imagens enviadas com sucesso`
          : `${uploaded} enviadas, ${errors.length} falharam`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[step5] Erro fatal:", msg);
    return NextResponse.json(
      { success: false, errors: [{ key: "_global", reason: msg }], message: msg },
      { status: 500 }
    );
  }
}
