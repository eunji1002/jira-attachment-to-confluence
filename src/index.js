import { asApp, fetch, route } from '@forge/api';

const CUSTOM_FIELD_ID_1 = 'customfield_10180';
const CUSTOM_FIELD_ID_2 = 'customfield_10181';

export async function run(event, context) {
  console.log('🔔 Triggered!');
  console.log('🧾 Raw Event:', JSON.stringify(event, null, 2));

  const issueKey = event.issue.key;
  const projectKey = event.issue.fields.project.key;
  const aliasKey = projectKey.toLowerCase(); // 예: 'kvce'

  try {
    const issueRes = await asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
    const issue = await issueRes.json();
    console.log("🧪 Issue access test OK:", issue.key);

    const selections1 = issue.fields[CUSTOM_FIELD_ID_1];
    const selections2 = issue.fields[CUSTOM_FIELD_ID_2];

    // 둘 중 하나라도 값이 있으면 사용
    const pageTitle = selections1?.[0]?.value ?? selections2?.[0]?.value;

    if (!pageTitle) {
      console.warn('⚠️ 업로드 대상 페이지가 선택되지 않았습니다.');
      return;
    }

    const allSpacesRes = await asApp().requestConfluence(
      route`/wiki/api/v2/spaces`
    );
    const allSpacesJson = await allSpacesRes.json();

    const matchedSpace = allSpacesJson.results.find(
      (space) => space.currentActiveAlias === aliasKey
    );

    if (!matchedSpace) {
      console.error(`❌ alias '${aliasKey}'에 해당하는 Confluence 스페이스를 찾을 수 없습니다.`);
      return;
    }

    const trueSpaceKey = matchedSpace.id;
    console.log(`🔎 '${aliasKey}' alias의 실제 spaceid는 '${trueSpaceKey}'`);

    // ✅ 페이지 목록 중 제목 매칭
    const pageListRes = await asApp().requestConfluence(
      route`/wiki/api/v2/spaces/${trueSpaceKey}/pages`
    );
    const pageList = await pageListRes.json();
    const matchedPage = pageList.results.find(
      (page) => page.title === pageTitle
    );

    if (!matchedPage) {
      console.error(`❌ '${pageTitle}' 제목의 페이지를 스페이스 '${trueSpaceKey}'에서 찾을 수 없습니다.`);
      return;
    }

    const confluencePageId = matchedPage.id;
    console.log(`✅ '${pageTitle}' 페이지 ID: ${confluencePageId}`);

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
        console.warn(`⚠️ Skipping item with null attachmentId`);
        continue;
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const fileMetaRes = await asApp().requestJira(
          route`/rest/api/3/attachment/${attachmentId}`,
          { headers: { Accept: 'application/json' } }
        );
        const attachmentMeta = await fileMetaRes.json();

        const filename = attachmentMeta?.filename ?? `attachment-${attachmentId}`;
        const contentUrl = attachmentMeta?.content;
        if (!contentUrl) continue;

        const fileResponse = await fetch(contentUrl, { method: 'GET' });
        const fileBuffer = await fileResponse.arrayBuffer();

        const formData = new FormData();
        formData.append('file', new Blob([fileBuffer]), filename);
        formData.append('minorEdit', 'true');

        const uploadRes = await asApp().requestConfluence(
          route`/wiki/rest/api/content/${confluencePageId}/child/attachment`,
          {
            method: 'POST',
            headers: { 'X-Atlassian-Token': 'no-check' },
            body: formData,
          }
        );

        console.log(`✅ Uploaded to page '${pageTitle}' (${filename})`);
      } catch (err) {
        console.error(`❌ Upload failed for attachmentId=${attachmentId}:`, err);
      }
    }
  } catch (err) {
    console.error("❌ App failed to process issue:", err);
  }
}
