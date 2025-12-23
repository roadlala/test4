// functions/api.js

export async function onRequest(context) {
  const { request, env } = context;

  // 1. 处理前端表单提交的 POST 请求
  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse({ ok: false, error: "数据格式错误" }, 400);
    }

    // 2. 核心检查：确保已经在控制台手动绑定了 DIARY_KV
    if (!env.DIARY_KV) {
      return jsonResponse({ 
        ok: false, 
        error: "KV 绑定未就绪。请在 Pages 设置中添加名为 DIARY_KV 的绑定。" 
      }, 500);
    }

    const sanitizedPayload = { ...payload };
    delete sanitizedPayload.passcode;

    const now = new Date();
    const record = {
      received_at: now.toISOString(),
      data: sanitizedPayload,
    };

    // 3. 生成存储键值：diary:日期:随机ID
    const date = now.toISOString().slice(0, 10);
    const key = `diary:${date}:${crypto.randomUUID()}`;

    try {
      // 写入您创建的 KV 空间
      await env.DIARY_KV.put(key, JSON.stringify(record));
      return jsonResponse({ ok: true, key });
    } catch (e) {
      return jsonResponse({ ok: false, error: "写入数据库失败" }, 500);
    }
  }

  // 2. 获取历史记录列表
  if (request.method === "GET") {
    if (!env.DIARY_KV) {
      return jsonResponse({
        ok: false,
        error: "KV 绑定未就绪。请在 Pages 设置中添加名为 DIARY_KV 的绑定。",
      }, 500);
    }

    const url = new URL(request.url);
    const limitParam = Number.parseInt(url.searchParams.get("limit"), 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;
    const cursor = url.searchParams.get("cursor") || undefined;

    const listResult = await env.DIARY_KV.list({ prefix: "diary:", limit, cursor });
    const values = await Promise.all(
      listResult.keys.map((item) => env.DIARY_KV.get(item.name, { type: "json" }))
    );

    const items = listResult.keys.map((item, index) => ({
      key: item.name,
      record: values[index],
    }));

    return jsonResponse({
      ok: true,
      items,
      cursor: listResult.cursor || null,
    });
  }

  // 3. 修改历史记录
  if (request.method === "PUT") {
    if (!env.DIARY_KV) {
      return jsonResponse({
        ok: false,
        error: "KV 绑定未就绪。请在 Pages 设置中添加名为 DIARY_KV 的绑定。",
      }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse({ ok: false, error: "数据格式错误" }, 400);
    }

    const key = typeof payload.key === "string" ? payload.key : "";
    if (!key.startsWith("diary:")) {
      return jsonResponse({ ok: false, error: "记录键无效" }, 400);
    }

    const rawData = payload.data && typeof payload.data === "object" ? payload.data : {};
    const sanitizedPayload = { ...rawData };
    delete sanitizedPayload.passcode;

    const existing = await env.DIARY_KV.get(key, { type: "json" });
    const now = new Date().toISOString();
    const record = {
      received_at: existing?.received_at || now,
      updated_at: now,
      data: sanitizedPayload,
    };

    await env.DIARY_KV.put(key, JSON.stringify(record));
    return jsonResponse({ ok: true, key });
  }

  // 4. 删除历史记录
  if (request.method === "DELETE") {
    if (!env.DIARY_KV) {
      return jsonResponse({
        ok: false,
        error: "KV 绑定未就绪。请在 Pages 设置中添加名为 DIARY_KV 的绑定。",
      }, 500);
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    if (!key.startsWith("diary:")) {
      return jsonResponse({ ok: false, error: "记录键无效" }, 400);
    }

    await env.DIARY_KV.delete(key);
    return jsonResponse({ ok: true, key });
  }

  // 其他请求返回 405
  return jsonResponse({ ok: false, error: "方法不允许" }, 405);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}
