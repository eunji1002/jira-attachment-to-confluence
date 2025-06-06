import { asApp, fetch, route } from '@forge/api';

const CONFLUENCE_PAGE_ID = '47415302';

export async function run(event, context) {
  console.log('🔔 Triggered!');
  console.log('🧾 Raw Event:', JSON.stringify(event, null, 2));

  try {
    const res = await asApp().requestJira(route`/rest/api/3/issue/${event.issue.key}`);
    const json = await res.json();

    console.log("🧪 Issue access test OK:", json.key);
  } catch (err) {
    console.error("❌ App cannot access this issue:", err);
  }

  const attachmentItems = event.changelog?.items?.filter(
    (item) => item.field === "Attachment"
  );

  if (!attachmentItems || attachmentItems.length === 0) {
    console.log("ℹ️ No new attachments in changelog.");
    return;
  }

  for (const item of attachmentItems) {
    const attachmentId = item.to;

    if (!attachmentId) {
      console.warn(`⚠️ Skipping item with null attachmentId:`, JSON.stringify(item));
      continue;
    }

    // 👉 디버깅 로그 추가
    console.log(`📌 issueKey: ${event.issue?.key}`);
    console.log(`📌 projectKey: ${event.issue?.fields?.project?.key}`);
    console.log(`👤 triggeredByUser: ${event.user?.accountId}`);
    console.log(`📎 changelog item:`, JSON.stringify(item));

    try {
      // 👉 잠시 기다려서 첨부파일 접근 가능성 확보
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const fileMetaRes = await asApp().requestJira(
        route`/rest/api/3/attachment/${attachmentId}`,
        { headers: { Accept: 'application/json' } }
      );
      const attachmentMeta = await fileMetaRes.json();

      console.log('📦 attachmentMeta:', JSON.stringify(attachmentMeta, null, 2));

      const filename = attachmentMeta?.filename ?? `attachment-${attachmentId}`;
      const contentUrl = attachmentMeta?.content;

      if (!contentUrl) {
        console.error(`❌ No content URL found for attachmentId=${attachmentId}`);
        continue;
      }

      const fileResponse = await fetch(contentUrl, {
        method: 'GET',
      });
      const fileBuffer = await fileResponse.arrayBuffer();

      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), filename);
      formData.append('minorEdit', 'true');

      const uploadRes = await asApp().requestConfluence(
        route`/wiki/rest/api/content/${CONFLUENCE_PAGE_ID}/child/attachment`,
        {
          method: 'POST',
          headers: {
            'X-Atlassian-Token': 'no-check',
          },
          body: formData,
        }
      );

      console.log(`✅ Uploaded to Confluence: ${filename}`, await uploadRes.text());
    } catch (err) {
      console.error(`❌ Error uploading attachmentId=${attachmentId}:`, err);
    }
  }
}
