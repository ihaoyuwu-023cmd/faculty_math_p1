(() => {
  "use strict";

  const API_BASE = "/api";
  const PAGE_SIZE = 20;
  const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];
  const STATUS_LABELS = {
    completed: "完整",
    complete: "完整",
    verified: "已核验",
    in_progress: "进行中",
    partial: "部分完成",
    partial_public_roster_limit: "来源受限",
    restricted: "受限",
    pending: "待处理",
    probable: "较可信",
    needs_review: "待复核",
    not_public: "未公开",
    open: "未解决",
    resolved: "已解决",
    deferred: "暂缓",
    skipped: "已跳过",
    active: "当前有效",
    historical_selection: "历史入选",
    status_not_public: "状态未公开"
  };
  const M_LABELS = {
    M0: "未公开/未细分",
    M1: "基础数学",
    M2: "计算数学",
    M3: "概率统计",
    M4: "应用数学",
    M5: "运筹学与控制论",
    M6: "系统科学",
    M7: "数学交叉",
    M8: "其它"
  };
  const ISSUE_TYPE_LABELS = {
    aggregate_talent_counts_without_names: "人才汇总有数量但无实名",
    current_roster_profile_affiliation_conflict: "当前名册与个人主页归属冲突",
    empty_official_roster: "官方名册为空",
    generic_core_talent_label: "核心人才称号未具体说明",
    generic_national_special_expert_label: "国家级特殊人才称号未具体说明",
    generic_talent_plan_name: "人才计划名称未具体说明",
    individual_profile_and_title_not_public: "个人主页与职称信息未公开",
    individual_profile_not_found: "未找到个人主页",
    noncore_aggregate_talent_page: "非核心人才汇总页无实名",
    official_count_conflict: "官方汇总数量冲突",
    official_count_conflict_retained: "官方汇总数量冲突（保留实名名单）",
    official_count_roster_conflict: "官方统计与实名名册冲突",
    official_count_scope_reconciliation: "官方数量与统计边界待核对",
    official_title_not_public_after_full_profile_review: "全面核查后官方职称未公开",
    on_leave_status: "离岗状态待核验",
    partial_public_roster_limit: "官方名册覆盖不足",
    restricted_source: "官方来源访问受限",
    supervisor_directory_not_current_employment_roster: "导师名录不等于当前在任名册",
    unspecified_high_level_talent: "高层次人才称号未明确"
  };
  const ISSUE_DESCRIPTION_LABELS = {
    aggregate_talent_counts_without_names: "官方页面只提供人才项目数量，未提供可逐人核对的实名名单。",
    current_roster_profile_affiliation_conflict: "当前在任名册与教师个人主页显示的院系归属不一致，需保留来源冲突标记。",
    empty_official_roster: "已找到官方教师入口，但页面未提供可核验的在任教师名册。",
    generic_core_talent_label: "个人主页披露国家重大人才项目 A 类青年人才，但未给出可纳入白名单的具体项目名称。",
    generic_national_special_expert_label: "个人主页披露国家级特聘专家称号，但未给出明确的人才项目名称。",
    generic_talent_plan_name: "官方页面仅披露为国家级高层次人才计划入选者，未公开项目全称。",
    individual_profile_and_title_not_public: "个人主页及对应职称信息未公开，暂不能完成个人层面的核验。",
    individual_profile_not_found: "未在官方教师入口中找到与该教师准确匹配的个人主页。",
    noncore_aggregate_talent_page: "非核心人才页面只提供汇总数量，未提供可逐人核对的实名和项目类别。",
    official_count_conflict: "学院概况、师资名册或其他官方页面的汇总数量存在差异。",
    official_count_conflict_retained: "官方汇总数量与实名名单存在差异，已保留实名名单，不反推缺失人员。",
    official_count_roster_conflict: "官方统计数字与实名教师名册无法闭合，未据此推算缺失姓名。",
    official_count_scope_reconciliation: "官方数量的统计口径与当前纳入范围尚未完全一致。",
    official_title_not_public_after_full_profile_review: "已检查官方个人页面及相关栏目，仍未公开明确职称信息。",
    on_leave_status: "官方页面显示离岗、休假或类似状态，当前在任情况待核验。",
    partial_public_roster_limit: "官方公开名册不能覆盖全部当前数学教师，保留已核实名单，不反推缺失姓名。",
    restricted_source: "官方来源当前访问受限，已记录原网址，不重复请求。",
    supervisor_directory_not_current_employment_roster: "导师名录中存在该人员，但不能单独证明其属于当前全职在任教师名册。",
    unspecified_high_level_talent: "官方页面披露高层次人才称号，但未明确对应的纳入项目。"
  };
  const T_LABELS = {
    T1: "国家级院士",
    T2: "国家重大人才计划",
    T3: "国家基金人才项目",
    T4: "教育部及中央部门"
  };
  const VIEWS = {
    summary: { title: "总览", kicker: "全国数学学科师资", nav: "summary" },
    schools: { title: "学校", kicker: "学校覆盖与采集状态", nav: "schools" },
    school: { title: "学校详情", kicker: "单校数据审阅", nav: "schools" },
    faculty: { title: "教师", kicker: "任职与研究方向", nav: "faculty" },
    issues: { title: "数据异常", kicker: "来源与边界审计", nav: "issues" },
    settings: { title: "应用设置", kicker: "轻量 App 配置", nav: "settings" }
  };

  const dom = {
    root: document.getElementById("view-root"),
    viewTitle: document.getElementById("view-title"),
    viewKicker: document.getElementById("view-kicker"),
    connection: document.querySelector(".connection-state"),
    connectionLabel: document.getElementById("connection-label"),
    drawer: document.getElementById("person-drawer"),
    drawerTitle: document.getElementById("drawer-title"),
    drawerContent: document.getElementById("drawer-content"),
    drawerBackdrop: document.getElementById("drawer-backdrop"),
    toastRegion: document.getElementById("toast-region")
  };

  const state = {
    route: "summary",
    routeParam: "",
    renderId: 0,
    requestId: 0,
    requests: new Map(),
    options: null,
    optionsPromise: null,
    compareIds: [],
    lastFocus: null,
    searchTimer: null,
    filters: {
      schools: { q: "", grade: "", status: "", sort: "officialOrder", order: "asc" },
      faculty: {
        q: "",
        school_id: "",
        unit_id: "",
        m_code: "",
        talent_code: "",
        page: 1,
        page_size: PAGE_SIZE
      },
      issues: { q: "" },
      talents: { q: "", t_code: "", page: 1, page_size: PAGE_SIZE }
    }
  };
  const composingSearchInputs = new WeakSet();

  const numberFormatter = new Intl.NumberFormat("zh-CN");
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function asNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const normalized = typeof value === "string" ? value.replaceAll(",", "").replace("%", "") : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatNumber(value) {
    const parsed = asNumber(value);
    return parsed === null ? "—" : numberFormatter.format(parsed);
  }

  function formatPercent(value, digits = 1) {
    const parsed = asNumber(value);
    if (parsed === null) return "—";
    const normalized = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
    return `${normalized.toFixed(digits).replace(/\.0$/, "")}%`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return dateFormatter.format(date);
  }

  function pick(object, keys, fallback = null) {
    if (!object || typeof object !== "object") return fallback;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== undefined) {
        return object[key];
      }
    }
    return fallback;
  }

  function textValue(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = pick(value, ["path", "absolute_path", "root", "evidence_root", "value"], "");
      return typeof nested === "string" ? nested : "";
    }
    return value === null || value === undefined ? "" : String(value);
  }

  function valueFrom(containers, keys, fallback = null) {
    for (const container of containers) {
      const value = pick(container, keys);
      if (value !== null && value !== undefined) return value;
    }
    return fallback;
  }

  function getPath(object, path) {
    return path.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), object);
  }

  function firstPath(containers, paths) {
    for (const container of containers) {
      for (const path of paths) {
        const value = getPath(container, path);
        if (value !== undefined && value !== null) return value;
      }
    }
    return null;
  }

  function unwrap(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    return payload.data !== undefined ? payload.data : payload;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "string") {
      return value
        .split(/[、,，;；|]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [value];
  }

  function extractItems(payload, keys) {
    const root = unwrap(payload);
    if (Array.isArray(root)) return root;
    const containers = [root, payload].filter(Boolean);
    for (const container of containers) {
      for (const key of keys) {
        if (Array.isArray(container?.[key])) return container[key];
      }
    }
    return [];
  }

  function extractPagination(payload, itemCount, fallbackPage = 1, fallbackSize = PAGE_SIZE) {
    const root = unwrap(payload) || {};
    const meta = pick(root, ["pagination", "page_info", "meta"], pick(payload, ["pagination", "page_info", "meta"], {})) || {};
    const page = asNumber(valueFrom([meta, root, payload], ["page", "current_page"]), fallbackPage);
    const pageSize = asNumber(valueFrom([meta, root, payload], ["page_size", "per_page", "limit"]), fallbackSize);
    const total = asNumber(valueFrom([meta, root, payload], ["total", "total_count", "count"]), itemCount);
    const totalPages = Math.max(
      1,
      asNumber(valueFrom([meta, root, payload], ["total_pages", "pages", "page_count"]), Math.ceil(total / Math.max(pageSize, 1)))
    );
    return { page, pageSize, total, totalPages };
  }

  function normalizeCodeList(value, prefix) {
    const codes = [];
    for (const item of asArray(value)) {
      const raw = typeof item === "object" ? pick(item, ["code", "level1_code", "category", "type"], "") : item;
      const matches = String(raw).toUpperCase().match(new RegExp(`${prefix}[0-9]+`, "g")) || [];
      for (const code of matches) {
        if (!codes.includes(code)) codes.push(code);
      }
    }
    return codes;
  }

  function normalizeDistribution(source, codes) {
    const values = Object.fromEntries(codes.map((code) => [code, 0]));
    if (Array.isArray(source)) {
      source.forEach((item, index) => {
        if (typeof item === "number") {
          if (codes[index]) values[codes[index]] = item;
          return;
        }
        if (!item || typeof item !== "object") return;
        const code = String(pick(item, ["code", "grade", "label", "name", "category"], codes[index] || ""));
        const matched = codes.find((candidate) => candidate.toUpperCase() === code.toUpperCase());
        if (matched) values[matched] = asNumber(pick(item, ["count", "school_count", "record_count", "holder_count", "value", "total", "n"], 0), 0);
      });
    } else if (source && typeof source === "object") {
      for (const code of codes) {
        const raw = source[code] ?? source[code.toLowerCase()];
        values[code] = asNumber(
          raw && typeof raw === "object" ? pick(raw, ["count", "school_count", "record_count", "holder_count", "value", "total", "n"], 0) : raw,
          0
        );
      }
    }
    return codes.map((code) => ({ code, count: values[code] }));
  }

  function distributionFrom(containers, paths, codes) {
    return normalizeDistribution(firstPath(containers, paths), codes);
  }

  function safeHref(raw) {
    if (!raw) return "";
    const value = String(raw).trim().replaceAll("\\", "/");
    if (!value) return "";
    if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("#")) {
      return value;
    }
    if (/^(reports|evidence)\//i.test(value)) return `/${value}`;
    try {
      const parsed = new URL(value, window.location.origin);
      if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
    } catch (_error) {
      return "";
    }
    return "";
  }

  function statusText(value) {
    if (!value) return "未知";
    return STATUS_LABELS[String(value).toLowerCase()] || String(value);
  }

  function statusClass(value) {
    return String(value || "pending").toLowerCase().replaceAll("_", "-");
  }

  function gradeClass(grade) {
    if (String(grade).startsWith("A")) return "grade-a";
    if (String(grade).startsWith("B")) return "grade-b";
    return "grade-c";
  }

  function gradeBadge(grade) {
    if (!grade) return '<span class="badge">未分级</span>';
    return `<span class="badge ${gradeClass(grade)}">${escapeHTML(grade)}</span>`;
  }

  function statusBadge(status) {
    return `<span class="badge status-${statusClass(status)}">${escapeHTML(statusText(status))}</span>`;
  }

  function codeTags(codes, prefix) {
    const validLabels = prefix === "M" ? M_LABELS : T_LABELS;
    const normalized = normalizeCodeList(codes, prefix).filter((code) => validLabels[code]);
    if (!normalized.length) return '<span class="cell-secondary">—</span>';
    return `<span class="tag-list">${normalized
      .map((code) => `<span class="tag code-${code}" title="${escapeHTML(validLabels[code])}">${code}</span>`)
      .join("")}</span>`;
  }

  function icon(name) {
    return `<i data-lucide="${escapeHTML(name)}" aria-hidden="true"></i>`;
  }

  function hydrateIcons() {
    if (!window.lucide?.createIcons) return;
    window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
  }

  function setView(html) {
    dom.root.innerHTML = html;
    hydrateIcons();
  }

  function pageHeader({ eyebrow, title, copy = "", actions = "" }) {
    return `
      <header class="page-header">
        <div class="page-heading">
          ${eyebrow ? `<span class="eyebrow">${escapeHTML(eyebrow)}</span>` : ""}
          <h1>${escapeHTML(title)}</h1>
          ${copy ? `<p>${escapeHTML(copy)}</p>` : ""}
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </header>`;
  }

  function loadingState(label = "正在读取本地数据") {
    const rows = Array.from({ length: 7 }, () => `
      <div class="skeleton-row" aria-hidden="true">
        ${Array.from({ length: 6 }, (_, index) => `<span class="skeleton-line" style="width:${index === 0 ? 76 : 54}%"></span>`).join("")}
      </div>`).join("");
    return `
      <div class="skeleton-block" role="status" aria-label="${escapeHTML(label)}">
        <div class="skeleton-table">${rows}</div>
      </div>`;
  }

  function statePanel({ kind = "empty", iconName = "inbox", title, message, action = "" }) {
    return `
      <section class="state-panel ${kind === "error" ? "is-error" : ""}">
        <div class="state-content">
          <span class="state-icon">${icon(iconName)}</span>
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(message)}</p>
          ${action}
        </div>
      </section>`;
  }

  function errorState(error, retryAction = "retry-route") {
    const message = error?.status === 404
      ? "请求的数据不存在或已被移除。"
      : "无法读取本地 API，请确认服务可用后重试。";
    return statePanel({
      kind: "error",
      iconName: "triangle-alert",
      title: "数据加载失败",
      message,
      action: `<button class="button" type="button" data-action="${retryAction}">${icon("refresh-cw")}重试</button>`
    });
  }

  function emptyState(title, message, resetScope = "") {
    const action = resetScope
      ? `<button class="button" type="button" data-action="reset-filters" data-scope="${resetScope}">${icon("rotate-ccw")}清除筛选</button>`
      : "";
    return statePanel({ iconName: "file-search", title, message, action });
  }

  function setConnection(kind) {
    dom.connection.dataset.connection = kind;
    dom.connectionLabel.textContent = kind === "ok" ? "本地服务已连接" : kind === "error" ? "本地服务异常" : "等待本地服务";
  }

  function cancelRequest(scope) {
    const active = state.requests.get(scope);
    if (active) {
      active.controller.abort();
      state.requests.delete(scope);
    }
  }

  async function requestJSON(path, { params = {}, scope = "view" } = {}) {
    cancelRequest(scope);
    const controller = new AbortController();
    const id = ++state.requestId;
    state.requests.set(scope, { controller, id });

    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
      else query.set(key, value);
    });
    const url = `${API_BASE}${path}${query.size ? `?${query.toString()}` : ""}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_error) {
          const parseError = new Error("本地 API 返回了无法解析的数据");
          parseError.status = response.status;
          throw parseError;
        }
      }
      if (!response.ok) {
        const apiError = new Error(pick(payload, ["message", "error", "detail"], `HTTP ${response.status}`));
        apiError.status = response.status;
        throw apiError;
      }
      setConnection("ok");
      return payload ?? {};
    } catch (error) {
      if (error.name !== "AbortError") setConnection("error");
      throw error;
    } finally {
      if (state.requests.get(scope)?.id === id) state.requests.delete(scope);
    }
  }

  async function updateEvidenceRoot(evidenceRoot) {
    const response = await fetch(`${API_BASE}/config/evidence-root`, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ evidence_root: evidenceRoot })
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        throw new Error("本地服务返回了无法解析的配置结果");
      }
    }
    if (!response.ok) {
      throw new Error(pick(payload, ["message", "error", "detail"], `HTTP ${response.status}`));
    }
    setConnection("ok");
    return payload;
  }

  function isAbort(error) {
    return error?.name === "AbortError";
  }

  function normalizeOptions(payload) {
    const root = unwrap(payload) || {};
    const schools = extractItems(root, ["schools", "school_options", "items"])
      .map((school) => ({
        id: String(pick(school, ["school_id", "id", "value", "code"], "")),
        name: String(pick(school, ["school_name", "name", "label"], "")),
        grade: pick(school, ["evaluation_grade", "grade"], "")
      }))
      .filter((school) => school.id && school.name);
    const units = extractItems(root, ["units", "departments", "unit_options"])
      .map((unit) => ({
        id: String(pick(unit, ["unit_id", "id", "value"], "")),
        name: String(pick(unit, ["unit_name", "name", "label"], "")),
        schoolId: String(pick(unit, ["school_id"], "")),
        schoolName: String(pick(unit, ["school_name"], ""))
      }))
      .filter((unit) => unit.id && unit.name);
    return {
      schools,
      units,
      grades: asArray(pick(root, ["grades", "evaluation_grades"], GRADE_ORDER)),
      statuses: asArray(pick(root, ["statuses", "completion_statuses"], ["completed", "partial", "restricted"]))
    };
  }

  function ensureOptions() {
    if (state.options) return Promise.resolve(state.options);
    if (!state.optionsPromise) {
      state.optionsPromise = requestJSON("/options", { scope: "options" })
        .then((payload) => {
          state.options = normalizeOptions(payload);
          state.optionsPromise = null;
          return state.options;
        })
        .catch((error) => {
          state.optionsPromise = null;
          throw error;
        });
    }
    return state.optionsPromise;
  }

  function showToast(message, kind = "default") {
    const toast = document.createElement("div");
    toast.className = `toast ${kind === "error" ? "is-error" : ""}`;
    toast.textContent = message;
    dom.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function parseHash() {
    const raw = window.location.hash.slice(1) || "summary";
    const [path, queryString = ""] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    const route = Object.prototype.hasOwnProperty.call(VIEWS, parts[0]) ? parts[0] : "summary";
    const params = new URLSearchParams(queryString);
    return {
      route,
      routeParam: route === "school" ? decodeURIComponent(parts.slice(1).join("/")) : "",
      facultySchoolId: route === "faculty" ? String(params.get("school_id") || "") : "",
      compareIds: route === "compare" ? (params.get("schools") || "").split(",").filter(Boolean).slice(0, 4) : []
    };
  }

  function updateChrome() {
    const meta = VIEWS[state.route] || VIEWS.summary;
    dom.viewTitle.textContent = meta.title;
    dom.viewKicker.textContent = meta.kicker;
    document.title = `${meta.title} · 数学师资数据审阅台`;
    document.querySelectorAll("[data-nav]").forEach((item) => {
      const active = item.dataset.nav === meta.nav;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function setCompareHash(ids) {
    const unique = [...new Set(ids.map(String))].slice(0, 4);
    const suffix = unique.length ? `?schools=${unique.map(encodeURIComponent).join(",")}` : "";
    window.location.hash = `compare${suffix}`;
  }

  function metricHTML({ label, value, note = "", iconName = "circle-dot", suffix = "" }) {
    return `
      <div class="metric">
        <span class="metric-label">${icon(iconName)}${escapeHTML(label)}</span>
        <strong class="metric-value">${escapeHTML(value)}${suffix ? `<small>${escapeHTML(suffix)}</small>` : ""}</strong>
        ${note ? `<span class="metric-note" title="${escapeHTML(note)}">${escapeHTML(note)}</span>` : ""}
      </div>`;
  }

  function barChart(distribution, { labels = {}, kind = "code" } = {}) {
    const max = Math.max(1, ...distribution.map((item) => asNumber(item.count, 0)));
    return `<div class="chart-list">${distribution
      .map((item) => {
        const count = asNumber(item.count, 0);
        const width = Math.max(0, Math.min(100, (count / max) * 100));
        const className = kind === "grade" ? gradeClass(item.code) : `code-${item.code}`;
        return `
          <div class="bar-row" title="${escapeHTML(labels[item.code] || item.code)}：${formatNumber(count)}">
            <span class="bar-label">${escapeHTML(item.code)}</span>
            <span class="bar-track"><span class="bar-fill ${className} ${count > 0 ? "has-value" : ""}" style="--bar-width:${width.toFixed(2)}%"></span></span>
            <span class="bar-value">${formatNumber(count)}</span>
          </div>`;
      })
      .join("")}</div>`;
  }

  function panelHeader(title, subtitle = "", meta = "") {
    return `
      <header class="panel-header">
        <div class="panel-heading"><h2>${escapeHTML(title)}</h2>${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ""}</div>
        ${meta ? `<span class="panel-meta">${escapeHTML(meta)}</span>` : ""}
      </header>`;
  }

  function schoolOptionHTML(selected = "") {
    const schools = state.options?.schools || [];
    return schools
      .map((school) => `<option value="${escapeHTML(school.id)}" ${school.id === String(selected) ? "selected" : ""}>${escapeHTML(school.name)}</option>`)
      .join("");
  }

  function unitOptionHTML(selected = "", schoolId = "") {
    const units = (state.options?.units || []).filter((unit) => !schoolId || unit.schoolId === schoolId);
    return units
      .map((unit) => `<option value="${escapeHTML(unit.id)}" ${unit.id === String(selected) ? "selected" : ""}>${escapeHTML(schoolId ? unit.name : `${unit.schoolName} · ${unit.name}`)}</option>`)
      .join("");
  }

  function sortHeader(label, key, filters, numeric = false) {
    const active = filters.sort === key;
    const direction = active ? filters.order : "none";
    const iconName = !active ? "chevrons-up-down" : filters.order === "asc" ? "arrow-up" : "arrow-down";
    return `<th class="${numeric ? "numeric" : ""}" aria-sort="${direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}">
      <button class="sort-button" type="button" data-action="sort-school" data-sort="${escapeHTML(key)}">${escapeHTML(label)}${icon(iconName)}</button>
    </th>`;
  }

  function paginationHTML(pagination, scope) {
    return `
      <div class="pagination" aria-label="分页">
        <button class="icon-button" type="button" data-action="change-page" data-scope="${scope}" data-page="${pagination.page - 1}" title="上一页" aria-label="上一页" ${pagination.page <= 1 ? "disabled" : ""}>${icon("chevron-left")}</button>
        <span class="page-label">${formatNumber(pagination.page)} / ${formatNumber(pagination.totalPages)} 页</span>
        <button class="icon-button" type="button" data-action="change-page" data-scope="${scope}" data-page="${pagination.page + 1}" title="下一页" aria-label="下一页" ${pagination.page >= pagination.totalPages ? "disabled" : ""}>${icon("chevron-right")}</button>
      </div>`;
  }

  function renderSummaryLoading() {
    setView(`<div class="page">${pageHeader({
      eyebrow: "数据快照",
      title: "全国总览",
      copy: ""
    })}${loadingState("正在读取总览")}</div>`);
  }

  async function renderSummary(token) {
    renderSummaryLoading();
    try {
      const payload = await requestJSON("/summary");
      if (token !== state.renderId) return;
      const root = unwrap(payload) || {};
      const summary = pick(root, ["summary", "metrics"], root) || root;
      const coverage = pick(root, ["coverage", "completion"], pick(summary, ["coverage", "completion"], {})) || {};
      const containers = [summary, root, coverage, pick(summary, ["counts"], {}), pick(root, ["counts"], {})];
      const schools = asNumber(valueFrom(containers, ["school_count", "schools_total", "total_schools", "schools"]), 127);
      const appointments = valueFrom(containers, ["appointment_count", "appointments_total", "total_appointments", "faculty_records"]);
      const persons = valueFrom(containers, ["person_count", "persons_total", "unique_person_count", "unique_people", "unique_persons", "faculty_unique"]);
      const talents = valueFrom(containers, ["talent_count", "talents_total", "talent_record_count", "total_talents", "talent_records"]);
      let publicRate = valueFrom(containers, ["direction_public_rate", "directions_public_rate", "public_direction_rate", "direction_coverage"]);
      const updatedAt = valueFrom(containers, ["updated_at", "snapshot_date", "generated_at", "as_of"]);
      const gradeDistribution = distributionFrom(
        [summary, root],
        ["grade_distribution", "grade_summary", "grades", "by_grade", "distributions.grades", "distributions.grade"],
        GRADE_ORDER
      );
      const mDistribution = distributionFrom(
        [summary, root],
        ["m_distribution", "direction_distribution", "directions", "directions_by_m", "by_m_code", "distributions.m", "distributions.directions"],
        Object.keys(M_LABELS)
      );
      const tDistribution = distributionFrom(
        [summary, root],
        ["t_distribution", "talent_distribution", "talent_tiers", "talents_by_t", "by_t_code", "distributions.t", "distributions.talents"],
        Object.keys(T_LABELS)
      );
      if (publicRate === null || publicRate === undefined) {
        const directionTotal = mDistribution.reduce((total, item) => total + item.count, 0);
        const unpublished = mDistribution.find((item) => item.code === "M0")?.count || 0;
        publicRate = directionTotal ? (directionTotal - unpublished) / directionTotal : null;
      }
      const knownDirections = asNumber(valueFrom(containers, ["directions_public", "public_directions", "direction_known_count"]));

      setView(`
        <div class="page">
          ${pageHeader({
            eyebrow: "数据快照",
            title: "全国总览",
            copy: updatedAt ? `数据快照 ${formatDate(updatedAt)}` : ""
          })}
          <section class="metric-strip is-summary" aria-label="核心指标">
            ${metricHTML({ label: "学校", value: formatNumber(schools), note: "第四轮数学学科参评单位", iconName: "university" })}
            ${metricHTML({ label: "任职记录", value: formatNumber(appointments), note: "同一人员多校任职分别计数", iconName: "briefcase-business" })}
            ${metricHTML({ label: "去重人数", value: formatNumber(persons), note: "跨学校与院系去重", iconName: "users" })}
            ${metricHTML({ label: "人才记录", value: formatNumber(talents), note: "T1–T4 国内项目", iconName: "award" })}
            ${metricHTML({ label: "方向公开率", value: formatPercent(publicRate), note: knownDirections !== null ? `${formatNumber(knownDirections)} 人有公开方向` : "按纳入任职记录计算", iconName: "scan-search" })}
          </section>
          <section class="chart-grid" aria-label="分类分布">
            <article class="chart-panel">
              ${panelHeader("学校等级", "第四轮学科评估", `${formatNumber(schools)} 校`)}
              ${barChart(gradeDistribution, { kind: "grade" })}
            </article>
            <article class="chart-panel">
              ${panelHeader("研究方向 M0–M8", "按任职记录的主方向归类", "M 类")}
              ${barChart(mDistribution, { labels: M_LABELS })}
            </article>
            <article class="chart-panel">
              ${panelHeader("人才层级 T1–T4", "按公开人才项目记录", "T 类")}
              ${barChart(tDistribution, { labels: T_LABELS })}
            </article>
          </section>
          <section class="section-panel summary-notes" aria-label="统计说明">
            ${panelHeader("说明", "统计范围与采集信息", "")}
            <div class="section-content">
              <ul class="issue-list">
                <li class="issue-item">
                  <div class="item-copy">国防科技大学、陆军工程大学（原解放军理工大学）不计入本次统计。</div>
                </li>
                <li class="issue-item">
                  <div class="item-copy">中国科学院大学不计入本次统计。</div>
                </li>
                <li class="issue-item">
                  <div class="item-title">采集日期</div>
                  <div class="item-copy">2026-07-18</div>
                </li>
              </ul>
            </div>
          </section>
        </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "数据快照", title: "全国总览" })}${errorState(error)}</div>`);
    }
  }

  function normalizeSchool(row) {
    const school = {
      id: String(pick(row, ["school_id", "id", "code"], "")),
      name: String(pick(row, ["school_name", "name"], "未命名学校")),
      historicalName: pick(row, ["historical_name", "former_name"], ""),
      grade: pick(row, ["evaluation_grade", "grade"], ""),
      status: pick(row, ["status", "completion_status", "collection_status"], "pending"),
      officialOrder: asNumber(pick(row, ["official_order", "order", "rank"])),
      units: asNumber(pick(row, ["unit_count", "units_count", "included_units"])),
      appointments: asNumber(pick(row, ["appointment_count", "appointments_count", "faculty_count", "included_appointments"])),
      persons: asNumber(pick(row, ["person_count", "persons_count", "unique_person_count", "unique_people", "unique_persons"])),
      talents: asNumber(pick(row, ["talent_count", "talents_count", "talent_record_count", "talent_records"])),
      directionRate: pick(row, ["direction_public_rate", "directions_public_rate", "public_direction_rate"]),
      primaryDirections: asNumber(pick(row, ["primary_direction_count", "direction_count"])),
      publishedDirections: asNumber(pick(row, ["published_direction_count", "public_direction_count"])),
      issues: asNumber(pick(row, ["issue_count", "issues_count", "open_issue_count"]))
    };
    if (school.directionRate === null || school.directionRate === undefined) {
      const denominator = school.appointments || school.primaryDirections;
      school.directionRate = denominator ? (school.publishedDirections || 0) / denominator : null;
    }
    return school;
  }

  function sortSchools(rows, filters) {
    const direction = filters.order === "desc" ? -1 : 1;
    const gradeRank = new Map(GRADE_ORDER.map((grade, index) => [grade, index]));
    return rows.slice().sort((left, right) => {
      let a = left[filters.sort];
      let b = right[filters.sort];
      if (filters.sort === "grade") {
        a = gradeRank.get(left.grade) ?? 99;
        b = gradeRank.get(right.grade) ?? 99;
      }
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
      return String(a).localeCompare(String(b), "zh-CN", { numeric: true }) * direction;
    });
  }

  function schoolToolbar(filters) {
    return `
      <form class="toolbar" data-filter-form="schools">
        <div class="field">
          <label for="school-query">学校搜索</label>
          <div class="input-wrap">${icon("search")}<input id="school-query" name="q" type="search" value="${escapeHTML(filters.q)}" placeholder="学校名称或历史名称" autocomplete="off" data-live-search="schools"></div>
        </div>
        <div class="field">
          <label for="school-grade">学科等级</label>
          <select id="school-grade" name="grade" data-auto-submit>
            <option value="">全部等级</option>
            ${GRADE_ORDER.map((grade) => `<option value="${grade}" ${filters.grade === grade ? "selected" : ""}>${grade}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="school-status">完成状态</label>
          <select id="school-status" name="status" data-auto-submit>
            <option value="">全部状态</option>
            <option value="complete" ${filters.status === "complete" ? "selected" : ""}>严格完成</option>
            <option value="partial_public_roster_limit" ${filters.status === "partial_public_roster_limit" ? "selected" : ""}>来源受限</option>
          </select>
        </div>
        <div class="toolbar-actions">
          <button class="button is-primary" type="submit">${icon("search")}查询</button>
          <button class="icon-button" type="button" data-action="reset-filters" data-scope="schools" title="清除筛选" aria-label="清除学校筛选">${icon("rotate-ccw")}</button>
        </div>
      </form>`;
  }

  function renderSchoolTable(rows, filters) {
    return `
      <div class="table-shell">
        <table class="data-table is-schools">
          <caption class="sr-only">学校统计列表</caption>
          <colgroup>
            <col style="width:56px"><col style="width:224px"><col span="7" style="width:90px">
          </colgroup>
          <thead><tr>
            ${sortHeader("序", "officialOrder", filters, true)}
            ${sortHeader("学校", "name", filters)}
            ${sortHeader("等级", "grade", filters)}
            ${sortHeader("院系", "units", filters, true)}
            ${sortHeader("任职", "appointments", filters, true)}
            ${sortHeader("去重人数", "persons", filters, true)}
            ${sortHeader("人才", "talents", filters, true)}
            ${sortHeader("方向公开率", "directionRate", filters, true)}
            ${sortHeader("问题", "issues", filters, true)}
          </tr></thead>
          <tbody>${rows.map((school) => `
            <tr class="is-clickable" data-school-id="${escapeHTML(school.id)}" tabindex="0" aria-label="查看${escapeHTML(school.name)}详情">
              <td class="numeric">${formatNumber(school.officialOrder)}</td>
              <td><a class="cell-main" href="#school/${encodeURIComponent(school.id)}">${escapeHTML(school.name)}</a>${school.historicalName ? `<span class="cell-secondary" title="${escapeHTML(school.historicalName)}">${escapeHTML(school.historicalName)}</span>` : ""}</td>
              <td>${gradeBadge(school.grade)}</td>
              <td class="numeric">${formatNumber(school.units)}</td>
              <td class="numeric">${formatNumber(school.appointments)}</td>
              <td class="numeric">${formatNumber(school.persons)}</td>
              <td class="numeric">${formatNumber(school.talents)}</td>
              <td class="numeric">${formatPercent(school.directionRate)}</td>
              <td class="numeric">${formatNumber(school.issues)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  async function renderSchools(token) {
    const filters = state.filters.schools;
    setView(`<div class="page">${pageHeader({
      eyebrow: "127 校",
      title: "学校审阅",
      copy: "第四轮数学学科评估上榜学校"
    })}${schoolToolbar(filters)}${loadingState("正在读取学校列表")}</div>`);
    try {
      const payload = await requestJSON("/schools", {
        params: {
          q: filters.q,
          grade: filters.grade,
          status: filters.status,
          page_size: 200
        }
      });
      if (token !== state.renderId) return;
      const rawRows = extractItems(payload, ["schools", "items", "results"]);
      const rows = sortSchools(rawRows.map(normalizeSchool), filters);
      const pagination = extractPagination(payload, rows.length, 1, 200);
      const content = rows.length
        ? renderSchoolTable(rows, filters)
        : emptyState("没有匹配的学校", "当前筛选结果为 0。", "schools");
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "127 校", title: "学校审阅", copy: "第四轮数学学科评估上榜学校" })}
        ${schoolToolbar(filters)}
        <div class="result-bar"><span>共 <strong>${formatNumber(pagination.total)}</strong> 所学校</span></div>
        ${content}
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "127 校", title: "学校审阅" })}${schoolToolbar(filters)}${errorState(error)}</div>`);
    }
  }

  function normalizeUnit(unit) {
    return {
      id: String(pick(unit, ["unit_id", "id"], "")),
      name: String(pick(unit, ["unit_name", "name"], "未命名院系")),
      level: pick(unit, ["unit_level", "level"], ""),
      scope: pick(unit, ["scope_mode", "scope"], ""),
      status: pick(unit, ["status", "verification_status"], "pending"),
      appointments: asNumber(pick(unit, ["appointment_count", "faculty_count", "appointments"])),
      officialUrl: safeHref(pick(unit, ["source_archive_url", "archive_url", "official_url", "url", "source_url"], "")),
      basis: pick(unit, ["inclusion_basis", "basis", "notes"], "")
    };
  }

  function normalizeRelatedUnit(unit) {
    return {
      id: String(pick(unit, ["related_id", "id"], "")),
      name: String(pick(unit, ["unit_name", "name"], "未命名相关单位")),
      treatment: String(pick(unit, ["treatment", "scope", "status"], "deferred")),
      status: String(pick(unit, ["verification_status", "status"], "needs_review")),
      note: String(pick(unit, ["note", "notes", "description"], "")),
      officialUrl: safeHref(pick(unit, ["source_archive_url", "archive_url", "official_url", "source_url", "url"], ""))
    };
  }

  function normalizeIssue(issue) {
    const rawType = String(pick(issue, ["issue_type", "type", "title"], "data_issue"));
    const rawDescription = String(pick(issue, ["description", "message", "notes"], ""));
    return {
      id: String(pick(issue, ["issue_id", "id"], "")),
      schoolName: String(pick(issue, ["school_name", "schoolName"], "")),
      personName: String(pick(issue, ["person_name", "personName"], "")),
      type: ISSUE_TYPE_LABELS[rawType] || rawType.replaceAll("_", " "),
      severity: String(pick(issue, ["severity", "level"], "low")),
      description: ISSUE_DESCRIPTION_LABELS[rawType] || rawDescription,
      status: String(pick(issue, ["status"], "open"))
    };
  }

  function normalizeTalent(row) {
    const person = pick(row, ["person"], {}) || {};
    const source = pick(row, ["source", "primary_source"], {}) || {};
    const personId = String(valueFrom([row, person], ["person_id", "id"], ""));
    const talentId = String(pick(row, ["talent_id", "id"], ""));
    return {
      id: talentId,
      personId,
      name: String(valueFrom([row, person], ["name_cn", "person_name", "name"], "未命名")),
      schoolId: String(pick(row, ["school_id"], "")),
      schoolName: String(pick(row, ["school_name", "school"], "")),
      schools: asArray(pick(row, ["schools", "affiliations"], [])).map((item) => typeof item === "object" ? pick(item, ["school_name", "name"], "") : item).filter(Boolean),
      code: String(pick(row, ["code", "t_code", "category"], "")),
      title: String(pick(row, ["title_raw", "project_name", "title", "talent_title"], "未公开项目名称")),
      normalizedTitle: String(pick(row, ["title_normalized", "normalized_title"], "")),
      subtype: String(pick(row, ["subtype", "project_subtype"], "")),
      year: asNumber(pick(row, ["selection_year", "year"])),
      status: String(pick(row, ["verification_status", "award_status", "status"], "")),
      count: asNumber(pick(row, ["record_count", "count"])),
      holders: asNumber(pick(row, ["holder_count", "person_count"])),
      isAggregate: !talentId && !personId && asNumber(pick(row, ["record_count", "count"])) !== null,
      sourceUrl: safeHref(valueFrom([row, source], ["source_archive_url", "archive_url", "source_url", "url", "evidence_url", "primary_source_url"], "")),
      sourceLabel: String(valueFrom([source, row], ["title", "source_title", "label"], "查看证据"))
    };
  }

  function normalizeSchoolDetail(payload) {
    const root = unwrap(payload) || {};
    const schoolRaw = pick(root, ["school"], root) || root;
    const school = normalizeSchool(schoolRaw);
    const metrics = pick(root, ["metrics", "summary", "counts"], {}) || {};
    const containers = [metrics, schoolRaw, root];
    school.units = asNumber(valueFrom(containers, ["unit_count", "units_count", "included_units"]), school.units);
    school.appointments = asNumber(valueFrom(containers, ["appointment_count", "appointments_count", "faculty_count"]), school.appointments);
    school.persons = asNumber(valueFrom(containers, ["person_count", "persons_count", "unique_person_count", "unique_people"]), school.persons);
    school.talents = asNumber(valueFrom(containers, ["talent_count", "talents_count", "talent_record_count"]), school.talents);
    school.directionRate = valueFrom(containers, ["direction_public_rate", "directions_public_rate"], school.directionRate);
    school.issues = asNumber(valueFrom(containers, ["issue_count", "issues_count", "open_issue_count"]), school.issues);
    const units = extractItems(root, ["units", "departments", "included_units"]).map(normalizeUnit);
    const relatedUnits = extractItems(root, ["related_units", "related_unit_notes", "related_departments"]).map(normalizeRelatedUnit);
    const talents = extractItems(root, ["talents", "talent_titles", "talent_records"]).map(normalizeTalent);
    const issues = extractItems(root, ["issues", "open_issues", "problems"]).map(normalizeIssue);
    const directions = extractItems(root, ["directions", "top_directions", "direction_topics"]);
    const mDistribution = distributionFrom(
      [root, metrics],
      ["m_distribution", "direction_distribution", "directions_by_m", "by_m_code", "distributions.m"],
      Object.keys(M_LABELS)
    );
    const tDistribution = distributionFrom(
      [root, metrics],
      ["t_distribution", "talent_distribution", "talents_by_t", "by_t_code", "distributions.t"],
      Object.keys(T_LABELS)
    );
    return {
      school,
      units,
      relatedUnits,
      talents,
      issues,
      directions,
      mDistribution,
      tDistribution,
      reportUrl: safeHref(valueFrom([root, schoolRaw], ["report_url", "report_path", "school_report_url"], "")),
      teacherReportUrl: safeHref(valueFrom([root, schoolRaw], ["teacher_report_url", "teacher_report_path"], "")),
      notes: valueFrom([schoolRaw, root], ["notes", "scope_note", "collection_note"], "")
    };
  }

  function renderUnits(units) {
    if (!units.length) return emptyState("暂无院系记录", "该学校没有可展示的纳入院系。", "");
    return `
      <div class="table-shell" style="border:0;border-radius:0">
        <table class="data-table is-units">
          <caption class="sr-only">纳入院系列表</caption>
          <colgroup><col style="width:220px"><col style="width:70px"><col style="width:110px"><col style="width:84px"><col style="width:90px"><col style="width:48px"></colgroup>
          <thead><tr><th>院系 / 研究机构</th><th>层级</th><th>纳入口径</th><th>状态</th><th class="numeric">任职</th><th>来源</th></tr></thead>
          <tbody>${units.map((unit) => `
            <tr>
              <td><span class="cell-main truncate" title="${escapeHTML(unit.name)}">${escapeHTML(unit.name)}</span>${unit.basis ? `<span class="cell-secondary" title="${escapeHTML(unit.basis)}">${escapeHTML(unit.basis)}</span>` : ""}</td>
              <td>${escapeHTML(unit.level || "—")}</td>
              <td>${escapeHTML(statusText(unit.scope).replace("whole_unit", "整建制").replace("fixed_team", "固定团队").replace("none", "未纳入"))}</td>
              <td>${statusBadge(unit.status)}</td>
              <td class="numeric">${formatNumber(unit.appointments)}</td>
              <td>${unit.officialUrl ? `<a class="link-button" href="${escapeHTML(unit.officialUrl)}" target="_blank" rel="noopener" title="打开院系来源" aria-label="打开${escapeHTML(unit.name)}来源">${icon("external-link")}</a>` : "—"}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function renderRelatedUnits(units) {
    if (!units.length) return '<p class="item-meta">暂无已记录的相关院系候选。</p>';
    const treatmentLabels = {
      context_only: "相关说明，不单列",
      included_separately: "纳入边界，待独立名册",
      deferred: "待核验",
      excluded: "排除"
    };
    return `
      <div class="table-shell" style="border:0;border-radius:0">
        <table class="data-table is-units">
          <caption class="sr-only">相关院系审计列表</caption>
          <colgroup><col style="width:260px"><col style="width:130px"><col><col style="width:54px"></colgroup>
          <thead><tr><th>相关单位</th><th>处理方式</th><th>说明</th><th>证据</th></tr></thead>
          <tbody>${units.map((unit) => `
            <tr>
              <td><span class="cell-main">${escapeHTML(unit.name)}</span></td>
              <td>${escapeHTML(treatmentLabels[unit.treatment] || unit.treatment)}</td>
              <td><span class="cell-secondary">${escapeHTML(unit.note || "未提供说明")}</span></td>
              <td>${unit.officialUrl ? `<a class="link-button" href="${escapeHTML(unit.officialUrl)}" target="_blank" rel="noopener" title="打开相关单位证据" aria-label="打开${escapeHTML(unit.name)}证据">${icon("external-link")}</a>` : "—"}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function renderDirectionTopics(directions) {
    if (!directions.length) return '<p class="item-meta">暂无可展示的方向条目。</p>';
    return `<ul class="direction-list">${directions.slice(0, 10).map((direction) => {
      const code = String(pick(direction, ["level1_code", "code", "m_code"], ""));
      const label = M_LABELS[code] || String(pick(direction, ["category_name", "level2_label", "label", "name", "raw_text", "direction"], "研究方向"));
      const count = asNumber(pick(direction, ["count", "person_count", "appointments"]));
      return `<li class="direction-item"><div class="item-title">${code ? `<span class="tag code-${escapeHTML(code)}">${escapeHTML(code)}</span>` : ""}<span>${escapeHTML(label)}</span>${count !== null ? `<span class="badge">${formatNumber(count)}</span>` : ""}</div></li>`;
    }).join("")}</ul>`;
  }

  function renderSchoolTalents(talents) {
    if (!talents.length) return '<p class="item-meta">暂无人才项目记录。</p>';
    return `<ul class="talent-list">${talents.slice(0, 12).map((talent) => `
      <li class="talent-item">
        <div class="item-title">${talent.code ? `<span class="tag code-${escapeHTML(talent.code)}">${escapeHTML(talent.code)}</span>` : ""}${talent.isAggregate ? `<span>${escapeHTML(T_LABELS[talent.code] || talent.code)}</span><span class="badge">${formatNumber(talent.count)} 条</span>` : `<button class="text-button" type="button" data-person-id="${escapeHTML(talent.personId)}" data-person-name="${escapeHTML(talent.name)}" ${talent.personId ? "" : "disabled"}>${escapeHTML(talent.name)}</button>`}</div>
        <div class="item-copy">${talent.isAggregate ? `${formatNumber(talent.holders)} 位人才持有者` : escapeHTML(talent.title)}</div>
        ${talent.sourceUrl ? `<div><a href="${escapeHTML(talent.sourceUrl)}" target="_blank" rel="noopener">${icon("external-link")}<span class="sr-only">打开证据</span></a></div>` : ""}
      </li>`).join("")}</ul>`;
  }

  function renderIssues(issues) {
    if (!issues.length) return '<p class="item-meta">没有未解决的数据问题。</p>';
    return `<ul class="issue-list">${issues.map((issue) => `
      <li class="issue-item">
        <div class="item-title"><span>${escapeHTML(issue.type)}</span></div>
        <div class="item-copy">${escapeHTML(issue.description || "未提供说明")}</div>
      </li>`).join("")}</ul>`;
  }

  async function renderSchoolDetail(token, schoolId) {
    if (!schoolId) {
      window.location.replace("#schools");
      return;
    }
    setView(`<div class="page">${pageHeader({
      eyebrow: "单校数据",
      title: "学校详情",
      actions: `<a class="button" href="#schools">${icon("arrow-left")}返回学校</a>`
    })}${loadingState("正在读取学校详情")}</div>`);
    try {
      const payload = await requestJSON(`/schools/${encodeURIComponent(schoolId)}`);
      if (token !== state.renderId) return;
      const detail = normalizeSchoolDetail(payload);
      const school = detail.school;
      const teacherReportAction = school.id
        ? `<a class="button teacher-report-button" href="#faculty?school_id=${encodeURIComponent(school.id)}">${icon("users")}<span class="optional-label">教师报告</span></a>`
        : `<button class="button" type="button" disabled title="暂无教师报告">${icon("file-x")}<span class="optional-label">暂无教师报告</span></button>`;
      setView(`<div class="page">
        ${pageHeader({
          eyebrow: "单校数据",
          title: school.name,
          copy: detail.notes || school.historicalName || "",
          actions: `<a class="button" href="#schools">${icon("arrow-left")}<span class="optional-label">返回学校</span></a>${teacherReportAction}`
        })}
        <div class="detail-title-row">${gradeBadge(school.grade)}${statusBadge(school.status)}${school.historicalName ? `<span class="badge">曾用名：${escapeHTML(school.historicalName)}</span>` : ""}</div>
        <section class="metric-strip is-school-detail" aria-label="学校核心指标">
          ${metricHTML({ label: "纳入院系", value: formatNumber(school.units), iconName: "building-2" })}
          ${metricHTML({ label: "任职记录", value: formatNumber(school.appointments), iconName: "briefcase-business" })}
          ${metricHTML({ label: "去重人数", value: formatNumber(school.persons), iconName: "users" })}
          ${metricHTML({ label: "人才记录", value: formatNumber(school.talents), iconName: "award" })}
          ${metricHTML({ label: "方向公开率", value: formatPercent(school.directionRate), iconName: "scan-search" })}
          ${metricHTML({ label: "数据问题", value: formatNumber(school.issues), iconName: "circle-alert" })}
        </section>
        <section class="section-panel">
          ${panelHeader("纳入院系", "院系与研究机构的采集边界", `${formatNumber(detail.units.length)} 项`)}
          <div class="section-content no-padding">${renderUnits(detail.units)}</div>
        </section>
        ${detail.relatedUnits.length ? `<section class="section-panel">
          ${panelHeader("相关院系审计", "相关单位保留说明，不自动计入任职记录", `${formatNumber(detail.relatedUnits.length)} 项`)}
          <div class="section-content no-padding">${renderRelatedUnits(detail.relatedUnits)}</div>
        </section>` : ""}
        <div class="detail-grid">
          <div class="detail-stack">
            <section class="section-panel">
              ${panelHeader("方向条目", "公开研究方向与二级标签")}
              <div class="section-content">${renderDirectionTopics(detail.directions)}</div>
            </section>
            <section class="section-panel">
              ${panelHeader("人才记录", "T1–T4 公开项目", `${formatNumber(detail.talents.length)} 条`)}
              <div class="section-content">${renderSchoolTalents(detail.talents)}</div>
            </section>
        </div>
        </div>
        <section class="section-panel detail-issues">
          ${panelHeader("数据问题", "待处理与已记录限制", `${formatNumber(detail.issues.length)} 项`)}
          <div class="section-content">${renderIssues(detail.issues)}</div>
        </section>
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "单校数据", title: "学校详情", actions: `<a class="button" href="#schools">${icon("arrow-left")}返回学校</a>` })}${errorState(error)}</div>`);
    }
  }

  function normalizeFaculty(row) {
    const person = pick(row, ["person"], {}) || {};
    const appointments = asArray(pick(row, ["appointments", "affiliations"], []));
    const schools = asArray(pick(row, ["schools", "school_names"], []))
      .map((school) => typeof school === "object" ? pick(school, ["school_name", "name"], "") : school)
      .filter(Boolean);
    const units = asArray(pick(row, ["units", "unit_names", "departments"], []))
      .map((unit) => typeof unit === "object" ? pick(unit, ["unit_name", "name"], "") : unit)
      .filter(Boolean);
    if (!schools.length) {
      const singleSchool = pick(row, ["school_name", "school"], "");
      if (singleSchool) schools.push(singleSchool);
      appointments.forEach((appointment) => {
        const name = pick(appointment, ["school_name", "school"], "");
        if (name && !schools.includes(name)) schools.push(name);
      });
    }
    if (!units.length) {
      const singleUnit = pick(row, ["unit_name", "department", "unit"], "");
      if (singleUnit) units.push(singleUnit);
      appointments.forEach((appointment) => {
        const name = pick(appointment, ["unit_name", "department", "unit"], "");
        if (name && !units.includes(name)) units.push(name);
      });
    }
    const directions = pick(row, ["directions", "research_directions"], []);
    const primaryDirection = pick(row, ["primary_direction"], {}) || {};
    const talents = pick(row, ["talents", "talent_titles"], []);
    const direction = String(
      pick(primaryDirection, ["raw_text", "display_text", "direction_display"], "") ||
      pick(row, ["raw_text", "direction_display", "display_text"], "") ||
      (directions.length ? pick(directions[0], ["raw_text", "display_text", "direction_display"], "") : "") ||
      "未公开/未细分"
    );
    const note = String(
      pick(primaryDirection, ["notes", "direction_note", "note"], "") ||
      pick(row, ["direction_note", "notes", "note"], "") ||
      "未公开/未细分"
    );
    return {
      id: String(valueFrom([row, person], ["person_id", "id"], "")),
      name: String(valueFrom([row, person], ["name_cn", "person_name", "name"], "未命名")),
      nameEn: String(valueFrom([row, person], ["name_en", "english_name"], "")),
      schoolId: String(pick(row, ["school_id"], "")),
      schools,
      units,
      title: String(pick(row, ["title_normalized", "title_raw", "title", "position"], "")),
      mCodes: normalizeCodeList(pick(row, ["m_codes", "direction_codes", "m_class", "primary_m_code"], directions), "M"),
      tCodes: normalizeCodeList(pick(row, ["t_codes", "talent_codes", "t_class"], talents), "T"),
      direction,
      note,
      appointments: asNumber(pick(row, ["appointment_count", "affiliation_count"], appointments.length || null)),
      verifiedOn: pick(row, ["verified_on", "updated_at"], ""),
      profileUrl: safeHref(pick(row, ["profile_url"], "")),
      sourceUrl: safeHref(pick(row, ["profile_archive_url", "source_archive_url", "archive_url", "evidence_url", "profile_url", "source_url"], ""))
    };
  }

  function facultyToolbar(filters) {
    return `
      <form class="toolbar is-faculty" data-filter-form="faculty">
        <div class="field">
          <label for="faculty-query">教师姓名</label>
          <div class="input-wrap">${icon("search")}<input id="faculty-query" name="q" type="search" value="${escapeHTML(filters.q)}" placeholder="中文名、英文名或别名" autocomplete="off" data-live-search="faculty"></div>
        </div>
        <div class="field">
          <label for="faculty-school">学校</label>
          <select id="faculty-school" name="school_id" data-auto-submit><option value="">全部学校</option>${schoolOptionHTML(filters.school_id)}</select>
        </div>
        <div class="field">
          <label for="faculty-unit">院系</label>
          <select id="faculty-unit" name="unit_id" data-auto-submit><option value="">全部院系</option>${unitOptionHTML(filters.unit_id, filters.school_id)}</select>
        </div>
        <div class="field">
          <label for="faculty-m">M 类</label>
          <select id="faculty-m" name="m_code" data-auto-submit><option value="">全部 M 类</option>${Object.entries(M_LABELS).map(([code, label]) => `<option value="${code}" ${filters.m_code === code ? "selected" : ""}>${code} · ${escapeHTML(label)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="faculty-talent">人才</label>
          <select id="faculty-talent" name="talent_code" data-auto-submit><option value="">全部人才</option>${Object.entries(T_LABELS).map(([code, label]) => `<option value="${code}" ${filters.talent_code === code ? "selected" : ""}>${code} · ${escapeHTML(label)}</option>`).join("")}</select>
        </div>
        <div class="toolbar-actions">
          <button class="button is-primary" type="submit">${icon("search")}查询</button>
          <button class="icon-button" type="button" data-action="reset-filters" data-scope="faculty" title="清除筛选" aria-label="清除教师筛选">${icon("rotate-ccw")}</button>
        </div>
      </form>`;
  }

  function renderFacultyTable(rows) {
    return `
      <div class="table-shell">
        <table class="data-table is-faculty">
          <caption class="sr-only">教师任职与方向列表</caption>
          <colgroup><col style="width:70px"><col style="width:120px"><col style="width:140px"><col style="width:70px"><col style="width:120px"><col><col style="width:150px"><col style="width:180px"><col style="width:100px"></colgroup>
          <thead><tr><th>姓名</th><th>学校</th><th>院系/单位</th><th>职称</th><th>M 分类</th><th>研究方向</th><th>备注</th><th>T1-T4 人才帽子</th><th>官方来源</th></tr></thead>
          <tbody>${rows.map((person) => `
            <tr class="is-clickable" data-person-row="${escapeHTML(person.id)}" data-person-name="${escapeHTML(person.name)}" tabindex="0" aria-label="查看${escapeHTML(person.name)}详情">
              <td>${person.profileUrl ? `<a class="text-button cell-main" href="${escapeHTML(person.profileUrl)}" target="_blank" rel="noopener">${escapeHTML(person.name)}</a>` : `<button class="text-button cell-main" type="button" data-person-id="${escapeHTML(person.id)}" data-person-name="${escapeHTML(person.name)}">${escapeHTML(person.name)}</button>`}${person.nameEn ? `<span class="cell-secondary" title="${escapeHTML(person.nameEn)}">${escapeHTML(person.nameEn)}</span>` : person.appointments > 1 ? `<span class="cell-secondary">${formatNumber(person.appointments)} 条任职</span>` : ""}</td>
              <td><span class="truncate" title="${escapeHTML(person.schools.join("、"))}">${escapeHTML(person.schools.join("、") || "—")}</span></td>
              <td>${stackedCellHTML(person.units)}</td>
              <td><span class="truncate" title="${escapeHTML(person.title)}">${escapeHTML(person.title || "—")}</span></td>
              <td>${mCellHTML(person.mCodes)}</td>
              <td><span class="wrap-cell" title="${escapeHTML(person.direction)}">${escapeHTML(person.direction || "未公开/未细分")}</span></td>
              <td><span class="wrap-cell" title="${escapeHTML(person.note)}">${escapeHTML(person.note || "未公开/未细分")}</span></td>
              <td>${talentCellHTML(person.tCodes)}</td>
              <td>${person.sourceUrl ? `<a class="link-button" href="${escapeHTML(person.sourceUrl)}" target="_blank" rel="noopener" title="打开教师来源" aria-label="打开${escapeHTML(person.name)}来源">${icon("external-link")}</a>` : "—"}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function stackedCellHTML(values, fallback = "—") {
    const normalized = (values || []).map((value) => String(value || "").trim()).filter(Boolean);
    if (!normalized.length) return `<span class="stacked-cell">${fallback}</span>`;
    return `<span class="stacked-cell" title="${escapeHTML(normalized.join("、"))}">${normalized.map((value) => `<span>${escapeHTML(value)}</span>`).join("")}</span>`;
  }

  function mCellHTML(codes) {
    const normalized = normalizeCodeList(codes, "M").filter((code) => M_LABELS[code]);
    if (!normalized.length) return '<span class="m-cell"><strong>M0</strong><span>未公开/未细分</span></span>';
    return `<span class="m-cell">${normalized.map((code) => `<strong>${escapeHTML(code)}</strong><span>${escapeHTML(M_LABELS[code])}</span>`).join("")}</span>`;
  }

  function talentCellHTML(codes) {
    const normalized = normalizeCodeList(codes, "T").filter((code) => T_LABELS[code]);
    const entries = normalized.map((code) => `<span class="talent-cell-entry"><strong>${escapeHTML(code)}</strong><span>${escapeHTML(T_LABELS[code])}</span></span>`);
    return entries.length ? `<span class="talent-cell">${entries.join("")}</span>` : "无";
  }

  async function renderFaculty(token) {
    const filters = state.filters.faculty;
    setView(`<div class="page">${pageHeader({ eyebrow: "人员检索", title: "教师", copy: "当前全职教学科研与研究系列任职" })}${facultyToolbar(filters)}${loadingState("正在读取教师列表")}</div>`);
    try {
      const [payload] = await Promise.all([
        requestJSON("/faculty", {
          params: {
            q: filters.q,
            school_id: filters.school_id,
            unit_id: filters.unit_id,
            direction: filters.m_code,
            talent: filters.talent_code,
            page: filters.page,
            page_size: filters.page_size
          }
        }),
        ensureOptions().catch(() => null)
      ]);
      if (token !== state.renderId) return;
      const rows = extractItems(payload, ["faculty", "people", "persons", "items", "results"]).map(normalizeFaculty);
      const pagination = extractPagination(payload, rows.length, filters.page, filters.page_size);
      filters.page = pagination.page;
      const content = rows.length ? renderFacultyTable(rows) : emptyState("没有匹配的教师", "当前筛选结果为 0。", "faculty");
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "人员检索", title: "教师", copy: "当前全职教学科研与研究系列任职" })}
        ${facultyToolbar(filters)}
        <div class="result-bar"><span>共 <strong>${formatNumber(pagination.total)}</strong> 条任职，本页 ${formatNumber(rows.length)} 条</span>${paginationHTML(pagination, "faculty")}</div>
        ${content}
        <div class="pagination-bottom">${paginationHTML(pagination, "faculty")}</div>
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "人员检索", title: "教师" })}${facultyToolbar(filters)}${errorState(error)}</div>`);
    }
  }

  function talentsToolbar(filters) {
    return `
      <form class="toolbar is-talent" data-filter-form="talents">
        <div class="field">
          <label for="talent-query">项目 / 姓名搜索</label>
          <div class="input-wrap">${icon("search")}<input id="talent-query" name="q" type="search" value="${escapeHTML(filters.q)}" placeholder="项目全称、姓名或学校" autocomplete="off" data-live-search="talents"></div>
        </div>
        <div class="segmented" role="group" aria-label="人才层级筛选">
          <button type="button" class="${filters.t_code ? "" : "is-active"}" data-action="set-talent-code" data-code="">全部</button>
          ${Object.keys(T_LABELS).map((code) => `<button type="button" class="${filters.t_code === code ? "is-active" : ""}" data-action="set-talent-code" data-code="${code}" title="${escapeHTML(T_LABELS[code])}">${code}</button>`).join("")}
        </div>
        <div class="toolbar-actions">
          <button class="button is-primary" type="submit">${icon("search")}查询</button>
          <button class="icon-button" type="button" data-action="reset-filters" data-scope="talents" title="清除筛选" aria-label="清除人才筛选">${icon("rotate-ccw")}</button>
        </div>
      </form>`;
  }

  function renderTalentTable(rows) {
    return `
      <div class="table-shell">
        <table class="data-table is-talents">
          <caption class="sr-only">人才项目与证据列表</caption>
          <colgroup><col style="width:132px"><col style="width:180px"><col style="width:72px"><col style="width:310px"><col style="width:88px"><col style="width:108px"><col style="width:54px"></colgroup>
          <thead><tr><th>姓名</th><th>学校</th><th>层级</th><th>项目 / 称号</th><th>年份</th><th>核验状态</th><th>证据</th></tr></thead>
          <tbody>${rows.map((talent) => {
            const schools = talent.schools.length ? talent.schools.join("、") : talent.schoolName;
            return `<tr>
              <td><button class="text-button cell-main" type="button" data-person-id="${escapeHTML(talent.personId)}" data-person-name="${escapeHTML(talent.name)}" ${talent.personId ? "" : "disabled"}>${escapeHTML(talent.name)}</button></td>
              <td><span class="truncate" title="${escapeHTML(schools)}">${escapeHTML(schools || "—")}</span></td>
              <td>${talent.code ? `<span class="tag code-${escapeHTML(talent.code)}" title="${escapeHTML(T_LABELS[talent.code] || talent.code)}">${escapeHTML(talent.code)}</span>` : "—"}</td>
              <td><span class="cell-main truncate" title="${escapeHTML(talent.title)}">${escapeHTML(talent.title)}</span>${talent.subtype ? `<span class="cell-secondary">${escapeHTML(talent.subtype)}</span>` : talent.normalizedTitle ? `<span class="cell-secondary">${escapeHTML(talent.normalizedTitle)}</span>` : ""}</td>
              <td>${formatNumber(talent.year)}</td>
              <td>${talent.status ? statusBadge(talent.status) : "—"}</td>
              <td>${talent.sourceUrl ? `<a class="link-button" href="${escapeHTML(talent.sourceUrl)}" target="_blank" rel="noopener" title="打开人才证据" aria-label="打开${escapeHTML(talent.name)}人才证据">${icon("external-link")}</a>` : "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
  }

  async function renderTalents(token) {
    const filters = state.filters.talents;
    setView(`<div class="page">${pageHeader({ eyebrow: "T1–T4", title: "人才项目", copy: "T1–T4 已核验记录" })}${talentsToolbar(filters)}${loadingState("正在读取人才列表")}</div>`);
    try {
      const payload = await requestJSON("/talents", {
        params: {
          q: filters.q,
          tier: filters.t_code,
          page: filters.page,
          page_size: filters.page_size
        }
      });
      if (token !== state.renderId) return;
      const rows = extractItems(payload, ["talents", "talent_titles", "items", "results"]).map(normalizeTalent);
      const pagination = extractPagination(payload, rows.length, filters.page, filters.page_size);
      filters.page = pagination.page;
      const content = rows.length ? renderTalentTable(rows) : emptyState("没有匹配的人才记录", "当前筛选结果为 0。", "talents");
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "T1–T4", title: "人才项目", copy: "T1–T4 已核验记录" })}
        ${talentsToolbar(filters)}
        <div class="result-bar"><span>共 <strong>${formatNumber(pagination.total)}</strong> 条记录，本页 ${formatNumber(rows.length)} 条</span>${paginationHTML(pagination, "talents")}</div>
        ${content}
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "T1–T4", title: "人才项目" })}${talentsToolbar(filters)}${errorState(error)}</div>`);
    }
  }

  function compareBuilder(optionsError = false) {
    const selected = state.compareIds.map((id) => state.options?.schools.find((school) => school.id === id) || { id, name: id });
    const atLimit = selected.length >= 4;
    return `
      <div class="compare-builder">
        <div class="field">
          <label for="compare-school">添加学校（最多 4 所）</label>
          <select id="compare-school" ${optionsError || atLimit ? "disabled" : ""}>
            <option value="">${optionsError ? "学校选项加载失败" : atLimit ? "已达到 4 所上限" : "选择一所学校"}</option>
            ${schoolOptionHTML("")}
          </select>
        </div>
        <button class="icon-button" type="button" data-action="add-compare" title="加入对比" aria-label="加入学校对比" ${optionsError || atLimit ? "disabled" : ""}>${icon("plus")}</button>
        <div class="compare-selection" aria-label="已选学校">
          ${selected.length ? selected.map((school) => `
            <span class="school-chip"><span title="${escapeHTML(school.name)}">${escapeHTML(school.name)}</span><button type="button" data-action="remove-compare" data-school-id="${escapeHTML(school.id)}" title="移除${escapeHTML(school.name)}" aria-label="移除${escapeHTML(school.name)}">${icon("x")}</button></span>`).join("") : '<span class="item-meta">尚未选择学校</span>'}
        </div>
      </div>`;
  }

  function normalizeCompareSchool(item) {
    const schoolBase = normalizeSchool(pick(item, ["school"], item) || item);
    const metrics = pick(item, ["metrics", "summary", "counts"], {}) || {};
    const containers = [metrics, item];
    schoolBase.units = asNumber(valueFrom(containers, ["unit_count", "units_count", "included_units"]), schoolBase.units);
    schoolBase.appointments = asNumber(valueFrom(containers, ["appointment_count", "appointments_count", "faculty_count"]), schoolBase.appointments);
    schoolBase.persons = asNumber(valueFrom(containers, ["person_count", "persons_count", "unique_people"]), schoolBase.persons);
    schoolBase.talents = asNumber(valueFrom(containers, ["talent_count", "talents_count"]), schoolBase.talents);
    schoolBase.directionRate = valueFrom(containers, ["direction_public_rate", "directions_public_rate"], schoolBase.directionRate);
    schoolBase.issues = asNumber(valueFrom(containers, ["issue_count", "issues_count"]), schoolBase.issues);
    return {
      ...schoolBase,
      mDistribution: distributionFrom([item, metrics], ["m_distribution", "direction_distribution", "directions", "directions_by_m", "by_m_code", "distributions.m"], Object.keys(M_LABELS)),
      tDistribution: distributionFrom([item, metrics], ["t_distribution", "talent_distribution", "talents", "talents_by_t", "by_t_code", "distributions.t"], Object.keys(T_LABELS))
    };
  }

  function compareMetricTable(schools) {
    const metricRows = [
      ["学科等级", (school) => gradeBadge(school.grade)],
      ["完成状态", (school) => statusBadge(school.status)],
      ["纳入院系", (school) => formatNumber(school.units)],
      ["任职记录", (school) => formatNumber(school.appointments)],
      ["去重人数", (school) => formatNumber(school.persons)],
      ["人才记录", (school) => formatNumber(school.talents)],
      ["方向公开率", (school) => formatPercent(school.directionRate)],
      ["数据问题", (school) => formatNumber(school.issues)]
    ];
    return `
      <div class="compare-scroll">
        <table class="compare-table">
          <caption class="sr-only">学校核心指标对比</caption>
          <thead><tr><th>指标</th>${schools.map((school) => `<th><a href="#school/${encodeURIComponent(school.id)}">${escapeHTML(school.name)}</a></th>`).join("")}</tr></thead>
          <tbody>${metricRows.map(([label, render]) => `<tr><td>${escapeHTML(label)}</td>${schools.map((school) => `<td>${render(school)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function compareDistributionTable(schools, type) {
    const labels = type === "M" ? M_LABELS : T_LABELS;
    const key = type === "M" ? "mDistribution" : "tDistribution";
    return `
      <div class="compare-scroll">
        <table class="compare-table">
          <caption class="sr-only">${type} 类分布对比</caption>
          <thead><tr><th>${type} 类</th>${schools.map((school) => `<th>${escapeHTML(school.name)}</th>`).join("")}</tr></thead>
          <tbody>${Object.keys(labels).map((code) => {
            const values = schools.map((school) => school[key].find((entry) => entry.code === code)?.count || 0);
            const max = Math.max(1, ...values);
            return `<tr><td title="${escapeHTML(labels[code])}">${code} · ${escapeHTML(labels[code])}</td>${values.map((value) => `<td><div class="compare-cell-bar"><span class="bar-track"><span class="bar-fill code-${code} ${value > 0 ? "has-value" : ""}" style="--bar-width:${((value / max) * 100).toFixed(2)}%"></span></span><span>${formatNumber(value)}</span></div></td>`).join("")}</tr>`;
          }).join("")}</tbody>
        </table>
      </div>`;
  }

  async function renderCompare(token) {
    setView(`<div class="page">${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}${loadingState("正在读取学校选项")}</div>`);
    try {
      await ensureOptions();
    } catch (error) {
      if (token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}${compareBuilder(true)}${errorState(error, "retry-options")}</div>`);
      return;
    }
    if (token !== state.renderId) return;
    state.compareIds = state.compareIds.filter((id, index, list) => id && list.indexOf(id) === index).slice(0, 4);
    if (!state.compareIds.length) {
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}
        ${compareBuilder()}
        ${statePanel({ iconName: "columns-3", title: "尚未选择学校", message: "" })}
      </div>`);
      return;
    }
    setView(`<div class="page">${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}${compareBuilder()}${loadingState("正在生成学校对比")}</div>`);
    try {
      const payload = await requestJSON("/compare", {
        params: { school_ids: state.compareIds.join(",") }
      });
      if (token !== state.renderId) return;
      let rows = extractItems(payload, ["schools", "comparison", "items", "results", "school_details"]).map(normalizeCompareSchool);
      const order = new Map(state.compareIds.map((id, index) => [id, index]));
      rows = rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
      const content = rows.length
        ? `${compareMetricTable(rows)}<section class="section-panel">${panelHeader("M 类方向对比", "各校研究方向记录数")}</section>${compareDistributionTable(rows, "M")}<section class="section-panel">${panelHeader("T 类人才对比", "各校人才项目记录数")}</section>${compareDistributionTable(rows, "T")}`
        : emptyState("没有可比较的数据", "所选学校暂未返回对比结果。", "");
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}
        ${compareBuilder()}
        ${content}
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "最多 4 校", title: "学校对比" })}${compareBuilder()}${errorState(error)}</div>`);
    }
  }

  function normalizePersonDetail(payload) {
    const root = unwrap(payload) || {};
    const person = pick(root, ["person"], root) || root;
    const appointments = extractItems(root, ["appointments", "affiliations", "positions"]);
    const directions = extractItems(root, ["directions", "research_directions"]);
    const talents = extractItems(root, ["talents", "talent_titles", "talent_records"]).map(normalizeTalent);
    const sources = extractItems(root, ["sources", "source_links", "evidence"]);
    return {
      id: String(pick(person, ["person_id", "id"], "")),
      name: String(pick(person, ["name_cn", "name", "person_name"], "未命名")),
      nameEn: String(pick(person, ["name_en", "english_name"], "")),
      aliases: asArray(pick(person, ["aliases", "alias"], [])),
      note: String(pick(person, ["disambiguation_note", "notes"], "")),
      appointments,
      directions,
      talents,
      sources
    };
  }

  function renderPersonDrawer(detail) {
    const affiliations = detail.appointments.length ? detail.appointments.map((appointment) => {
      const school = pick(appointment, ["school_name", "school"], "未知学校");
      const unit = pick(appointment, ["unit_name", "department", "unit"], "未注明院系");
      const title = pick(appointment, ["title_normalized", "title_raw", "title", "position"], "未注明职称");
      const fullTime = pick(appointment, ["full_time"], null);
      const profile = safeHref(pick(appointment, ["profile_archive_url", "source_archive_url", "profile_url", "source_url"], ""));
      return `<li class="affiliation-item">
        <div class="item-title"><span>${escapeHTML(school)}</span>${fullTime !== null ? `<span class="badge">${Number(fullTime) ? "全职" : "非全职"}</span>` : ""}</div>
        <div class="item-copy">${escapeHTML(unit)} · ${escapeHTML(title)}</div>
        ${profile ? `<div><a href="${escapeHTML(profile)}" target="_blank" rel="noopener">教师主页 ${icon("external-link")}</a></div>` : ""}
      </li>`;
    }).join("") : '<p class="item-meta">暂无任职信息。</p>';

    const directions = detail.directions.length ? detail.directions.map((direction) => {
      const code = String(pick(direction, ["level1_code", "m_code", "code"], "M0"));
      const display = String(pick(direction, ["raw_text", "display_text", "direction_display"], "未公开/未细分"));
      const note = String(pick(direction, ["notes", "direction_note", "note"], "未公开/未细分"));
      const level2 = String(pick(direction, ["level2_label", "secondary_label"], ""));
      const evidenceType = String(pick(direction, ["evidence_type", "source_type"], ""));
      const sourceUrl = safeHref(pick(direction, ["source_archive_url", "source_url", "evidence_url"], ""));
      return `<li class="direction-item">
        <div class="item-title"><span class="tag code-${escapeHTML(code)}">${escapeHTML(code)}</span><span>${escapeHTML(level2 || M_LABELS[code] || "研究方向")}</span></div>
        <div class="item-copy">${escapeHTML(display)}</div>
        <div class="item-meta">备注：${escapeHTML(note)}</div>
        <div class="item-meta">${escapeHTML(evidenceType ? `证据类型：${evidenceType}` : "")}${sourceUrl ? ` · <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">来源</a>` : ""}</div>
      </li>`;
    }).join("") : '<p class="item-meta">暂无公开方向记录。</p>';

    const talents = detail.talents.length ? detail.talents.map((talent) => `<li class="talent-item">
      <div class="item-title">${talent.code ? `<span class="tag code-${escapeHTML(talent.code)}">${escapeHTML(talent.code)}</span>` : ""}<span>${escapeHTML(talent.title)}</span></div>
      <div class="item-meta">${talent.year ? `${formatNumber(talent.year)} 年 · ` : ""}${escapeHTML(statusText(talent.status))}</div>
      ${talent.sourceUrl ? `<div><a href="${escapeHTML(talent.sourceUrl)}" target="_blank" rel="noopener">项目证据 ${icon("external-link")}</a></div>` : ""}
    </li>`).join("") : '<p class="item-meta">暂无人才项目记录。</p>';

    const sources = detail.sources.length ? detail.sources.map((source) => {
      const label = String(pick(source, ["page_title", "title", "source_title", "label", "url"], "证据来源"));
      const url = safeHref(pick(source, ["archive_url", "source_archive_url", "url", "source_url", "local_url", "evidence_url"], ""));
      const date = pick(source, ["accessed_on", "verified_on", "date"], "");
      return `<li><span class="truncate" title="${escapeHTML(label)}">${escapeHTML(label)}</span>${url ? `<a class="link-button" href="${escapeHTML(url)}" target="_blank" rel="noopener" title="打开来源" aria-label="打开${escapeHTML(label)}">${icon("external-link")}</a>` : date ? `<strong>${escapeHTML(formatDate(date))}</strong>` : ""}</li>`;
    }).join("") : '<p class="item-meta">暂无独立来源条目。</p>';

    return `
      <section class="drawer-section">
        <div class="detail-title-row"><h3 style="margin:0">${escapeHTML(detail.name)}</h3>${detail.nameEn ? `<span class="badge">${escapeHTML(detail.nameEn)}</span>` : ""}</div>
        ${detail.aliases.length ? `<p class="item-meta">别名：${escapeHTML(detail.aliases.join("、"))}</p>` : ""}
        ${detail.note ? `<p class="item-copy">${escapeHTML(detail.note)}</p>` : ""}
      </section>
      <section class="drawer-section"><h3>任职与所属</h3><ul class="affiliation-list">${affiliations}</ul></section>
      <section class="drawer-section"><h3>研究方向</h3><ul class="direction-list">${directions}</ul></section>
      <section class="drawer-section"><h3>人才帽子</h3><ul class="talent-list">${talents}</ul></section>
      <section class="drawer-section"><h3>来源与证据</h3><ul class="source-list">${sources}</ul></section>`;
  }

  async function openPersonDrawer(personId, fallbackName = "教师详情") {
    if (!personId) return;
    state.lastFocus = document.activeElement;
    dom.drawerTitle.textContent = fallbackName;
    dom.drawerContent.innerHTML = loadingState("正在读取教师详情");
    dom.drawerBackdrop.hidden = false;
    dom.drawer.classList.add("is-open");
    dom.drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-drawer");
    hydrateIcons();
    window.setTimeout(() => dom.drawer.querySelector('[data-action="close-drawer"]')?.focus(), 20);
    try {
      const payload = await requestJSON(`/people/${encodeURIComponent(personId)}`, { scope: "drawer" });
      if (!dom.drawer.classList.contains("is-open")) return;
      const detail = normalizePersonDetail(payload);
      dom.drawerTitle.textContent = detail.name;
      dom.drawerContent.innerHTML = renderPersonDrawer(detail);
      hydrateIcons();
    } catch (error) {
      if (isAbort(error)) return;
      dom.drawerContent.innerHTML = errorState(error, "retry-person");
      dom.drawerContent.querySelector('[data-action="retry-person"]')?.setAttribute("data-person-id", personId);
      dom.drawerContent.querySelector('[data-action="retry-person"]')?.setAttribute("data-person-name", fallbackName);
      hydrateIcons();
    }
  }

  function closePersonDrawer({ restoreFocus = true } = {}) {
    cancelRequest("drawer");
    dom.drawer.classList.remove("is-open");
    dom.drawer.setAttribute("aria-hidden", "true");
    dom.drawerBackdrop.hidden = true;
    document.body.classList.remove("has-drawer");
    if (restoreFocus && state.lastFocus instanceof HTMLElement) state.lastFocus.focus();
    state.lastFocus = null;
  }

  function readFilterForm(form) {
    const scope = form.dataset.filterForm;
    const filters = state.filters[scope];
    if (!filters) return;
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      if (Object.prototype.hasOwnProperty.call(filters, key)) filters[key] = String(value).trim();
    }
    if (scope === "faculty" && filters.school_id && filters.unit_id) {
      const unit = state.options?.units.find((item) => item.id === filters.unit_id);
      if (unit && unit.schoolId !== filters.school_id) filters.unit_id = "";
    }
    if (Object.prototype.hasOwnProperty.call(filters, "page")) filters.page = 1;
  }

  function resetFilters(scope) {
    if (scope === "schools") state.filters.schools = { q: "", grade: "", status: "", sort: "officialOrder", order: "asc" };
    if (scope === "faculty") state.filters.faculty = { q: "", school_id: "", unit_id: "", m_code: "", talent_code: "", page: 1, page_size: PAGE_SIZE };
    if (scope === "talents") state.filters.talents = { q: "", t_code: "", page: 1, page_size: PAGE_SIZE };
  }

  function issuePageToolbar(filters) {
    return `<form class="toolbar is-issues" data-issue-form>
      <div class="field">
        <label for="issue-query">关键词</label>
        <div class="input-wrap">${icon("search")}<input id="issue-query" name="q" type="search" value="${escapeHTML(filters.q)}" placeholder="学校、问题类型、说明或姓名" autocomplete="off" data-live-search="issues"></div>
      </div>
      <div class="toolbar-actions"><button class="button is-primary" type="submit">${icon("search")}筛选</button><button class="icon-button" type="button" data-action="reset-issue-filters" title="清除异常筛选" aria-label="清除异常筛选">${icon("rotate-ccw")}</button></div>
    </form>`;
  }

  function issueTable(items) {
    if (!items.length) return emptyState("没有匹配的数据异常", "当前筛选结果为 0。", "issues");
    return `<div class="table-shell issue-table-shell"><table class="data-table issue-table"><caption class="sr-only">数据异常问题列表</caption><colgroup><col style="width:150px"><col style="width:260px"><col></colgroup><thead><tr><th>学校</th><th>问题类型</th><th>说明</th></tr></thead><tbody>${items.map((issue) => `<tr><td>${escapeHTML(issue.schoolName || "—")}</td><td>${escapeHTML(issue.type || "数据问题")}</td><td><span class="truncate" title="${escapeHTML(issue.description)}">${escapeHTML(issue.description || "—")}</span></td></tr>`).join("")}</tbody></table></div>`;
  }

  async function renderIssuesPage(token) {
    const filters = state.filters.issues;
    setView(`<div class="page">${pageHeader({ eyebrow: "数据审计", title: "数据异常", copy: "来源冲突、访问限制和组织边界问题汇总" })}${issuePageToolbar(filters)}${loadingState("正在读取数据异常")}</div>`);
    try {
      const payload = await requestJSON("/issues", { params: filters, scope: "issues" });
      if (token !== state.renderId) return;
      const root = unwrap(payload) || {};
      const items = extractItems(root, ["items", "issues", "results"]).map(normalizeIssue);
      setView(`<div class="page">${pageHeader({ eyebrow: "数据审计", title: "数据异常", copy: "来源冲突、访问限制和组织边界问题汇总" })}${issuePageToolbar(filters)}<div class="result-bar"><span>共 <strong>${formatNumber(asNumber(pick(root, ["count", "total"], items.length)))}</strong> 项</span></div>${issueTable(items)}</div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "数据审计", title: "数据异常" })}${issuePageToolbar(filters)}${errorState(error)}</div>`);
    }
  }

  async function renderSettings(token) {
    setView(`<div class="page">${pageHeader({ eyebrow: "应用配置", title: "应用设置", copy: "默认只打开官网；配置静态证据包后才启用本地证据" })}${loadingState("正在读取应用配置")}</div>`);
    try {
      const payload = await requestJSON("/config", { scope: "config" });
      if (token !== state.renderId) return;
      const evidenceRoot = textValue(payload.evidence_root).trim();
      const mode = payload.evidence_mode === "external-configured" ? "已配置外部静态证据包" : "当前仅使用官网地址";
      setView(`<div class="page">
        ${pageHeader({ eyebrow: "应用配置", title: "应用设置", copy: "默认只打开官网；配置静态证据包后才启用本地证据" })}
        <section class="section-panel settings-panel">
          ${panelHeader("静态证据包", mode, "路径")}
          <form class="settings-form" data-config-form>
            <label for="evidence-root">静态证据包路径</label>
            <div class="settings-input-row">
              <input id="evidence-root" name="evidence_root" type="text" value="${escapeHTML(evidenceRoot)}" placeholder="例如 C:\\...\\evidence-package" autocomplete="off">
              <button class="button is-primary" type="submit">${icon("save")}保存路径</button>
              <button class="button" type="button" data-action="clear-evidence-root">${icon("x")}清除</button>
            </div>
            <p class="item-meta">路径为空时，教师和人才来源只跳转官网原始地址；路径有效后，存在对应文件的来源才显示本地证据链接。</p>
          </form>
        </section>
      </div>`);
    } catch (error) {
      if (isAbort(error) || token !== state.renderId) return;
      setView(`<div class="page">${pageHeader({ eyebrow: "应用配置", title: "应用设置" })}${errorState(error)}</div>`);
    }
  }

  function renderRoute({ scroll = false } = {}) {
    cancelRequest("view");
    const token = ++state.renderId;
    updateChrome();
    if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
    if (state.route === "summary") return renderSummary(token);
    if (state.route === "schools") return renderSchools(token);
    if (state.route === "school") return renderSchoolDetail(token, state.routeParam);
    if (state.route === "faculty") return renderFaculty(token);
    if (state.route === "issues") return renderIssuesPage(token);
    if (state.route === "settings") return renderSettings(token);
    if (state.route === "talents") return renderTalents(token);
    if (state.route === "compare") return renderCompare(token);
    return renderSummary(token);
  }

  function syncRouteFromHash({ scroll = true } = {}) {
    const parsed = parseHash();
    state.route = parsed.route;
    state.routeParam = parsed.routeParam;
    if (parsed.route === "faculty") {
      const previousSchoolId = state.filters.faculty.school_id;
      state.filters.faculty.school_id = parsed.facultySchoolId;
      if (previousSchoolId !== parsed.facultySchoolId) {
        state.filters.faculty.unit_id = "";
        state.filters.faculty.page = 1;
      }
    }
    if (parsed.route === "compare") state.compareIds = parsed.compareIds;
    closePersonDrawer({ restoreFocus: false });
    renderRoute({ scroll });
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-filter-form]");
    if (!form) return;
    event.preventDefault();
    const composingInput = form.querySelector("[data-live-search]");
    if (composingInput && composingSearchInputs.has(composingInput)) return;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    readFilterForm(form);
    renderRoute();
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-config-form]");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("[name=\"evidence_root\"]");
    const button = form.querySelector("button[type=\"submit\"]");
    if (!input || !button) return;
    button.disabled = true;
    try {
      const evidenceRoot = textValue(input.value).trim();
      if (evidenceRoot === "[object Object]") {
        throw new Error("请输入静态证据包文件夹的绝对路径");
      }
      const payload = await updateEvidenceRoot(evidenceRoot);
      showToast(payload.evidence_mode === "external-configured" ? "静态证据包路径已启用" : "已恢复为官网地址模式");
      renderRoute();
    } catch (error) {
      showToast(error.message || "保存配置失败", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-issue-form]");
    if (!form) return;
    event.preventDefault();
    const filters = state.filters.issues;
    const data = new FormData(form);
    filters.q = String(data.get("q") || "").trim();
    renderRoute();
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches("[data-auto-submit]")) input.closest("form")?.requestSubmit();
  });

  function scheduleLiveSearch(input) {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.searchTimer = null;
      const form = input.closest("form");
      if (form?.isConnected) form.requestSubmit();
    }, 360);
  }

  document.addEventListener("compositionstart", (event) => {
    const input = event.target.closest("[data-live-search]");
    if (!input) return;
    composingSearchInputs.add(input);
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
  });

  document.addEventListener("compositionend", (event) => {
    const input = event.target.closest("[data-live-search]");
    if (!input) return;
    composingSearchInputs.delete(input);
    scheduleLiveSearch(input);
  });

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-live-search]");
    if (!input || event.isComposing || composingSearchInputs.has(input)) return;
    scheduleLiveSearch(input);
  });

  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    const action = actionTarget?.dataset.action;
    if (action === "refresh" || action === "retry-route") {
      renderRoute();
      return;
    }
    if (action === "retry-options") {
      state.options = null;
      state.optionsPromise = null;
      renderRoute();
      return;
    }
    if (action === "retry-person") {
      openPersonDrawer(actionTarget.dataset.personId, actionTarget.dataset.personName);
      return;
    }
    if (action === "close-drawer") {
      closePersonDrawer();
      return;
    }
    if (action === "reset-filters") {
      resetFilters(actionTarget.dataset.scope);
      renderRoute();
      return;
    }
    if (action === "clear-evidence-root") {
      const input = document.querySelector("[data-config-form] [name=\"evidence_root\"]");
      if (input) {
        input.value = "";
        input.form?.requestSubmit();
      }
      return;
    }
    if (action === "reset-issue-filters") {
      state.filters.issues = { q: "" };
      renderRoute();
      return;
    }
    if (action === "sort-school") {
      const filters = state.filters.schools;
      const key = actionTarget.dataset.sort;
      if (filters.sort === key) filters.order = filters.order === "asc" ? "desc" : "asc";
      else {
        filters.sort = key;
        filters.order = ["name", "grade", "status"].includes(key) ? "asc" : "desc";
      }
      renderRoute();
      return;
    }
    if (action === "change-page") {
      const filters = state.filters[actionTarget.dataset.scope];
      const page = asNumber(actionTarget.dataset.page);
      if (filters && page && page > 0) {
        filters.page = page;
        renderRoute({ scroll: true });
      }
      return;
    }
    if (action === "set-talent-code") {
      state.filters.talents.t_code = actionTarget.dataset.code || "";
      state.filters.talents.page = 1;
      renderRoute();
      return;
    }
    if (action === "add-compare") {
      const select = document.getElementById("compare-school");
      const id = select?.value;
      if (!id) {
        showToast("请先选择一所学校", "error");
        return;
      }
      if (state.compareIds.includes(id)) {
        showToast("该学校已在对比中", "error");
        return;
      }
      if (state.compareIds.length >= 4) {
        showToast("最多同时对比 4 所学校", "error");
        return;
      }
      setCompareHash([...state.compareIds, id]);
      return;
    }
    if (action === "remove-compare") {
      setCompareHash(state.compareIds.filter((id) => id !== actionTarget.dataset.schoolId));
      return;
    }

    const personButton = event.target.closest("[data-person-id]");
    if (personButton && !personButton.disabled) {
      event.preventDefault();
      openPersonDrawer(personButton.dataset.personId, personButton.dataset.personName);
      return;
    }

    const schoolRow = event.target.closest("tr[data-school-id]");
    if (schoolRow && !event.target.closest("a,button")) {
      window.location.hash = `school/${encodeURIComponent(schoolRow.dataset.schoolId)}`;
      return;
    }

    const personRow = event.target.closest("tr[data-person-row]");
    if (personRow && !event.target.closest("a,button")) {
      openPersonDrawer(personRow.dataset.personRow, personRow.dataset.personName);
    }
  });

  dom.drawerBackdrop.addEventListener("click", () => closePersonDrawer());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.drawer.classList.contains("is-open")) {
      closePersonDrawer();
      return;
    }
    const row = event.target.closest("tr[data-school-id], tr[data-person-row]");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (row.dataset.schoolId) window.location.hash = `school/${encodeURIComponent(row.dataset.schoolId)}`;
      else openPersonDrawer(row.dataset.personRow, row.dataset.personName);
      return;
    }
    if (event.key === "Tab" && dom.drawer.classList.contains("is-open")) {
      const focusable = [...dom.drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener("hashchange", () => syncRouteFromHash({ scroll: true }));
  window.addEventListener("offline", () => setConnection("error"));

  if (!window.location.hash) window.history.replaceState(null, "", "#summary");
  hydrateIcons();
  syncRouteFromHash({ scroll: false });
})();
