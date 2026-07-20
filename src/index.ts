interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Udbud.dk MCP — Danish government public procurement notices (keyless).
 *
 * Wraps the public, no-auth JSON API behind udbud.dk, Denmark's official
 * national tender portal (Konkurrence- og Forbrugerstyrelsen). Udbud.dk
 * carries both EU-threshold notices (also on TED) and Danish national
 * below-EU-threshold notices that TED misses, plus direct awards, market
 * dialogues, and contract modifications.
 *
 * Verified endpoints (all live-tested, keyless):
 *   POST /soegning/public/soegeresultat   — search; body is a SoegningQueryDto:
 *     fritekstQuery                       — free-text search (verified: filters
 *                                           results and is echoed back)
 *     pagineringDto.maksElementer         — page size
 *     pagineringDto.aktuelSide            — 1-BASED page number (min 1)
 *     pagineringDto.sorteringFelt         — RELEVANCE | PUBLIKATION_DATO |
 *                                           TILBUDSFRIST_DATO
 *     pagineringDto.retning               — Asc | Desc (server default is Asc,
 *                                           so Desc must be sent explicitly
 *                                           for newest-first)
 *     filterDto.cpvKoder: []              — CPV filter; matches the CPV family
 *                                           (trailing zeros treated as prefix,
 *                                           secondary CPVs also match)
 *     filterDto.koeberCvr: []             — buyer CVR number(s)
 *     filterDto.formularType: []          — notice-type enum (see TYPE_LABELS)
 *     filterDto.publikationDatoFra/-Til   — publication date range, YYYY-MM-DD
 *                                           (dd-mm-yyyy is rejected with 400)
 *     udbudStatusFilter                   — AKTIV | ALLE
 *   Response: { resultatElementDtoList, soegningQueryDto (echo),
 *               totaltAntalResultater }. Each element has dataDa + dataEn
 *   (English CPV/type labels; Danish free text), noticeId, noticeVersion,
 *   noticePublicationNumber.
 *
 *   GET /soegning/visning/{noticeId}/{noticeVersion}?noticePublicationNumber=…
 *     — keyless detail (the ?noticePublicationNumber param is REQUIRED; without
 *     it the endpoint 404s). Returns htmlDA/htmlEN (full eForms render) and
 *     opsummeringDA/opsummeringEN summary cards.
 *
 * Human notice URL (verified 200, public SPA route):
 *   https://udbud.dk/detaljevisning?noticeId=…&noticeVersion=…&noticePublicationNumber=…
 *
 * All tools return shaped, LLM-friendly objects (not raw API passthrough) and
 * never throw — fetch/parse failures resolve to { error, retry_hint }. English
 * keys; English field values are used where udbud.dk provides them (dataEn),
 * Danish free text (titles, descriptions) passes through as-is.
 */


const SEARCH_URL = 'https://udbud.dk/soegning/public/soegeresultat';
const DETAIL_URL = (id: string, version: string) => `https://udbud.dk/soegning/visning/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
const NOTICE_URL = (id: string, version: string, pubNo: string) =>
  `https://udbud.dk/detaljevisning?noticeId=${encodeURIComponent(id)}&noticeVersion=${encodeURIComponent(version)}&noticePublicationNumber=${encodeURIComponent(pubNo)}`;
// udbud.dk serves a browser SPA; use a browser UA for reliable responses.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 8000;

// filterDto.formularType enum values (from the udbud.dk SPA's own
// FilterDtoFormularTypeItem codelist; NATIONALE_UDBUD live-verified).
const TYPE_LABELS: Record<string, string> = {
  FORVENTET_INDKOEB: 'Forventet indkøb (planned procurement)',
  MARKEDSDIALOGER: 'Markedsdialoger (market dialogues / consultations)',
  FORHAANDSMEDDELELSER: 'Forhåndsmeddelelser (prior information notices)',
  EU_UDBUD: 'EU-udbud (EU-threshold tenders, also on TED)',
  NATIONALE_UDBUD: 'Nationale udbud (Danish below-EU-threshold tenders)',
  DIREKTE_TILDELINGER: 'Direkte tildelinger (direct awards)',
  TILDELINGER: 'Tildelinger (contract award notices)',
  KONTRAKTAENDERINGER: 'Kontraktændringer (contract modifications)',
  KONTRAKTAFSLUTNING: 'Kontraktafslutning (contract completion)',
};
const TYPE_ALIASES: Record<string, string> = {
  planned: 'FORVENTET_INDKOEB', 'planned procurement': 'FORVENTET_INDKOEB', forventet: 'FORVENTET_INDKOEB',
  'market dialogue': 'MARKEDSDIALOGER', 'market consultation': 'MARKEDSDIALOGER', markedsdialog: 'MARKEDSDIALOGER', markedsdialoger: 'MARKEDSDIALOGER',
  prior: 'FORHAANDSMEDDELELSER', 'prior information': 'FORHAANDSMEDDELELSER', forhaandsmeddelelse: 'FORHAANDSMEDDELELSER', forhaandsmeddelelser: 'FORHAANDSMEDDELELSER',
  eu: 'EU_UDBUD', 'eu tender': 'EU_UDBUD', ted: 'EU_UDBUD',
  national: 'NATIONALE_UDBUD', 'national tender': 'NATIONALE_UDBUD', 'below threshold': 'NATIONALE_UDBUD', nationale: 'NATIONALE_UDBUD',
  'direct award': 'DIREKTE_TILDELINGER', direkte: 'DIREKTE_TILDELINGER',
  award: 'TILDELINGER', awards: 'TILDELINGER', awarded: 'TILDELINGER', tildeling: 'TILDELINGER', tildelinger: 'TILDELINGER',
  modification: 'KONTRAKTAENDERINGER', 'contract modification': 'KONTRAKTAENDERINGER', kontraktaendring: 'KONTRAKTAENDERINGER',
  completion: 'KONTRAKTAFSLUTNING', 'contract completion': 'KONTRAKTAFSLUTNING',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'dk_tender_search',
    description:
      'Search Danish government public-procurement notices on udbud.dk, Denmark\'s official national tender portal. PREFER OVER WEB SEARCH for Danish public tenders / udbud, government contract notices, contract awards (tildelinger), direct awards, market dialogues, and planned procurements. Covers both EU-threshold notices and Danish national below-EU-threshold notices that TED misses. Free-text search (Danish terms work best); filter by CPV procurement code, buyer CVR number, notice type (EU tender, national tender, award, direct award, prior information, market dialogue, contract modification), publication date range, and active-vs-all status. Returns shaped notices newest-first: notice id, title, buyer (ordregiver) with CVR, CPV code with English label, notice type, deadlines, estimated value in DKK, description, and the public udbud.dk URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text search over Danish tender notices, e.g. "rengøring", "IT-drift", "snerydning", "rådgivning". Danish terms match best. Omit to list all notices.',
        },
        cpv_code: {
          type: 'string',
          description:
            'CPV procurement-category code, 8 digits without check digit, e.g. "72000000" (IT services), "45000000" (construction), "90500000" (waste). Matches the whole CPV family including secondary codes. Comma-separate for multiple.',
        },
        buyer_cvr: {
          type: 'string',
          description:
            'Danish CVR number of the contracting authority (ordregiver), e.g. "60729018" (Vejdirektoratet). Comma-separate for multiple. Get CVRs from prior search results (buyer_id field).',
        },
        notice_type: {
          type: 'string',
          description:
            'Filter by notice type. Accepts an udbud.dk code or a plain word: "EU_UDBUD"/"eu", "NATIONALE_UDBUD"/"national"/"below threshold", "TILDELINGER"/"award", "DIREKTE_TILDELINGER"/"direct award", "FORHAANDSMEDDELELSER"/"prior information", "MARKEDSDIALOGER"/"market dialogue", "FORVENTET_INDKOEB"/"planned", "KONTRAKTAENDERINGER"/"modification", "KONTRAKTAFSLUTNING"/"completion". Omit for all types.',
        },
        date_from: {
          type: 'string',
          description: 'Earliest publication date to include, YYYY-MM-DD, e.g. "2026-01-01". Omit for all time.',
        },
        date_to: {
          type: 'string',
          description: 'Latest publication date to include, YYYY-MM-DD. Omit for up to today.',
        },
        status: {
          type: 'string',
          enum: ['all', 'active'],
          description: '"all" (default) includes closed and awarded notices; "active" restricts to currently open procurements.',
        },
        order: {
          type: 'string',
          enum: ['newest', 'relevance', 'oldest', 'deadline'],
          description:
            '"newest" (default) sorts by publication date descending; "relevance" ranks by match quality against the query; "oldest" sorts by publication date ascending; "deadline" sorts by tender deadline.',
        },
        limit: { type: ['number', 'string'], description: 'Number of notices to return (1-50). Default 10.' },
        page: { type: ['number', 'string'], description: 'ONE-based results page for pagination (first page is 1). Default 1.' },
      },
    },
  },
  {
    name: 'dk_tender_recent',
    description:
      'List the latest Danish government tenders and contract awards published on udbud.dk (Denmark\'s national public-procurement portal) in the last N days. Great for monitoring new Danish contract notices, fresh awards (tildelinger), direct awards, and upcoming bid deadlines — including national below-EU-threshold udbud that TED misses. Optionally restrict to one notice type or to currently active procurements. Returns shaped notices newest-first with notice id, title, buyer with CVR, CPV code, estimated value in DKK, deadlines, and the public udbud.dk URL.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: ['number', 'string'],
          description: 'Lookback window in days (1-90). Default 7 — notices published in the last week.',
        },
        notice_type: {
          type: 'string',
          description:
            'Filter by notice type. Accepts an udbud.dk code or a plain word: "EU_UDBUD"/"eu", "NATIONALE_UDBUD"/"national", "TILDELINGER"/"award", "DIREKTE_TILDELINGER"/"direct award", "FORHAANDSMEDDELELSER"/"prior information", "MARKEDSDIALOGER"/"market dialogue", "FORVENTET_INDKOEB"/"planned", "KONTRAKTAENDERINGER"/"modification". Omit for all types.',
        },
        status: {
          type: 'string',
          enum: ['all', 'active'],
          description: '"all" (default) includes awards and closed notices; "active" restricts to currently open procurements.',
        },
        limit: { type: ['number', 'string'], description: 'Number of notices to return (1-50). Default 10.' },
        page: { type: ['number', 'string'], description: 'ONE-based results page for pagination (first page is 1). Default 1.' },
      },
    },
  },
  {
    name: 'dk_tender_detail',
    description:
      'Fetch one Danish public-procurement notice from udbud.dk (Denmark government tender portal) in full detail. Returns the shaped notice summary — title, buyer (ordregiver) with CVR, publication date, CPV code, notice type, estimated value in DKK, deadlines, lot count, execution place, tender documents — plus the complete notice text extracted from the official eForms rendering (English version when available). Requires the notice_id, notice_version, and publication_number exactly as returned by dk_tender_search or dk_tender_recent.',
    inputSchema: {
      type: 'object',
      properties: {
        notice_id: {
          type: 'string',
          description: 'Notice UUID from search results, e.g. "14f9c6aa-740c-46ce-95a8-47df319d7de5".',
        },
        publication_number: {
          type: 'string',
          description: 'Notice publication number from search results (publication_number field), e.g. "00724546-2024".',
        },
        notice_version: {
          type: 'string',
          description: 'Notice version from search results, e.g. "01". Default "01".',
        },
        language: {
          type: 'string',
          enum: ['en', 'da'],
          description: 'Language of the full notice text: "en" (default, machine-assisted English) or "da" (original Danish).',
        },
        max_text_chars: {
          type: ['number', 'string'],
          description: 'Maximum characters of full notice text to return (0-30000). Default 8000. Set 0 to skip the full text and return only the summary.',
        },
      },
      required: ['notice_id', 'publication_number'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'dk_tender_search':
        return await searchTenders(args);
      case 'dk_tender_recent':
        return await recentTenders(args);
      case 'dk_tender_detail':
        return await getDetail(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
      retry_hint: 'udbud.dk may be briefly unavailable — retry once; if it persists, narrow the query or date range.',
    };
  }
}

// --- tools -----------------------------------------------------------------

interface SearchBody {
  fritekstQuery?: string;
  pagineringDto: { maksElementer: number; aktuelSide: number; sorteringFelt: string; retning: string };
  filterDto?: Record<string, unknown>;
  udbudStatusFilter?: string;
}

async function searchTenders(args: Record<string, unknown>): Promise<unknown> {
  const query = strArg(args.query);
  const dateFrom = dateArg(args.date_from);
  const dateTo = dateArg(args.date_to);
  const limit = clampInt(args.limit, 10, 1, 50);
  const page = clampInt(args.page, 1, 1, 100000); // aktuelSide is 1-based
  const status = strArg(args.status)?.toLowerCase() === 'active' ? 'AKTIV' : 'ALLE';

  const orderArg = strArg(args.order)?.toLowerCase();
  let sorteringFelt = 'PUBLIKATION_DATO';
  let retning = 'Desc';
  if (orderArg === 'relevance') { sorteringFelt = 'RELEVANCE'; }
  else if (orderArg === 'oldest') { retning = 'Asc'; }
  else if (orderArg === 'deadline') { sorteringFelt = 'TILBUDSFRIST_DATO'; }
  const order = orderArg === 'relevance' || orderArg === 'oldest' || orderArg === 'deadline' ? orderArg : 'newest';

  const typeRes = resolveType(strArg(args.notice_type));
  if ('error' in typeRes) return typeRes;

  const cpvKoder = listArg(args.cpv_code);
  for (const c of cpvKoder) {
    if (!/^\d{2,8}$/.test(c)) {
      return {
        error: `Invalid cpv_code "${c}". udbud.dk expects the bare digits of a CPV code (2-8 digits), e.g. "72000000" or "45000000".`,
        retry_hint: 'Drop the check digit and any dash: use "48000000", not "48000000-8".',
      };
    }
  }
  const koeberCvr = listArg(args.buyer_cvr);

  const filterDto: Record<string, unknown> = {};
  if (cpvKoder.length) filterDto.cpvKoder = cpvKoder;
  if (koeberCvr.length) filterDto.koeberCvr = koeberCvr;
  if (typeRes.code) filterDto.formularType = [typeRes.code];
  if (dateFrom) filterDto.publikationDatoFra = dateFrom;
  if (dateTo) filterDto.publikationDatoTil = dateTo;

  const body: SearchBody = {
    pagineringDto: { maksElementer: limit, aktuelSide: page, sorteringFelt, retning },
    udbudStatusFilter: status,
  };
  if (query) body.fritekstQuery = query;
  if (Object.keys(filterDto).length) body.filterDto = filterDto;

  const data = await udbudSearch(body);
  return shapePage(data, {
    query,
    cpv_code: cpvKoder.length ? cpvKoder.join(',') : undefined,
    buyer_cvr: koeberCvr.length ? koeberCvr.join(',') : undefined,
    notice_type: typeRes.code ?? undefined,
    date_from: dateFrom,
    date_to: dateTo,
    status: status === 'AKTIV' ? 'active' : 'all',
    order,
    page,
    limit,
  });
}

async function recentTenders(args: Record<string, unknown>): Promise<unknown> {
  const days = clampInt(args.days, 7, 1, 90);
  const limit = clampInt(args.limit, 10, 1, 50);
  const page = clampInt(args.page, 1, 1, 100000);
  const status = strArg(args.status)?.toLowerCase() === 'active' ? 'AKTIV' : 'ALLE';
  const typeRes = resolveType(strArg(args.notice_type));
  if ('error' in typeRes) return typeRes;

  const dateFrom = fmtDate(new Date(Date.now() - days * 86400000));
  const filterDto: Record<string, unknown> = { publikationDatoFra: dateFrom };
  if (typeRes.code) filterDto.formularType = [typeRes.code];

  const body: SearchBody = {
    pagineringDto: { maksElementer: limit, aktuelSide: page, sorteringFelt: 'PUBLIKATION_DATO', retning: 'Desc' },
    filterDto,
    udbudStatusFilter: status,
  };

  const data = await udbudSearch(body);
  return shapePage(data, {
    days,
    date_from: dateFrom,
    notice_type: typeRes.code ?? undefined,
    status: status === 'AKTIV' ? 'active' : 'all',
    page,
    limit,
  });
}

async function getDetail(args: Record<string, unknown>): Promise<unknown> {
  const id = strArg(args.notice_id);
  const pubNo = strArg(args.publication_number);
  const version = strArg(args.notice_version) ?? '01';
  const lang = strArg(args.language)?.toLowerCase() === 'da' ? 'da' : 'en';
  const maxChars = clampInt(args.max_text_chars, 8000, 0, 30000);
  if (!id || !pubNo) {
    return {
      error: 'dk_tender_detail requires "notice_id" (UUID) and "publication_number" (e.g. "00724546-2024").',
      retry_hint: 'Both come from dk_tender_search / dk_tender_recent results — the notice_id and publication_number fields.',
    };
  }

  const url = `${DETAIL_URL(id, version)}?noticePublicationNumber=${encodeURIComponent(pubNo)}`;
  const d = (await udbudGet(url)) as Record<string, any>;

  const ops = (lang === 'en' ? d.opsummeringEN : d.opsummeringDA) ?? d.opsummeringEN ?? d.opsummeringDA ?? {};
  const card = ops.card ?? {};
  const html: unknown = lang === 'en' ? d.htmlEN ?? d.htmlDA : d.htmlDA ?? d.htmlEN;
  const fullText = maxChars > 0 && typeof html === 'string' ? htmlToText(html) : '';
  const truncated = fullText.length > maxChars;

  return {
    notice_id: id,
    notice_version: version,
    publication_number: pubNo,
    title: card.titel ?? null,
    buyer: card.ordregiver ?? null,
    buyer_id: card.ordregiverIdDatavasket ?? card.ordregiverId ?? null,
    all_buyers: Array.isArray(card.alleOrdregivere) ? card.alleOrdregivere : [],
    publication_date: card.publiceringsdato ?? null,
    cpv_code: card.cpvKode ?? null,
    cpv_title: card.cpvTitel ?? null,
    notice_type: card.formulartype ?? null,
    notice_subtype: card.bkSubType ?? null,
    is_amendment: card.erAendring ?? null,
    estimated_value: card.anslaaetVaerdi ?? null,
    estimated_value_currency: card.anslaaetVaerdiValuta ?? null,
    description: card.beskrivelse ?? null,
    deadlines: Array.isArray(card.tidsfrister) ? card.tidsfrister : [],
    tender_deadlines: Array.isArray(ops.tilbudsfrister) ? ops.tilbudsfrister : [],
    participation_deadlines: Array.isArray(ops.deltagelsefrister) ? ops.deltagelsefrister : [],
    execution_place: {
      country: Array.isArray(ops.udforelsesstedLand) ? ops.udforelsesstedLand : [],
      region: Array.isArray(ops.udforelsesstedSubLand) ? ops.udforelsesstedSubLand : [],
      city: Array.isArray(ops.udforelsesstedBy) ? ops.udforelsesstedBy : [],
      nuts_codes: Array.isArray(ops.udforelsesstedNutsCode) ? ops.udforelsesstedNutsCode : [],
    },
    lot_count: ops.antalLots ?? null,
    part_count: ops.antalParts ?? null,
    tender_documents: Array.isArray(ops.udbudsDokumenter) ? ops.udbudsDokumenter : [],
    content_source: ops.indholdsType ?? null,
    language: lang,
    full_text: maxChars > 0 ? (truncated ? `${fullText.slice(0, maxChars)}…` : fullText) : null,
    full_text_truncated: maxChars > 0 ? truncated : null,
    url: NOTICE_URL(id, version, pubNo),
  };
}

// --- shaping ---------------------------------------------------------------

function shapeListItem(r: Record<string, any>): Record<string, unknown> {
  // Prefer the English variant (English CPV/type labels); fall back to Danish.
  const d = r.dataEn ?? r.dataDa ?? {};
  const id = typeof r.noticeId === 'string' ? r.noticeId : '';
  const version = typeof r.noticeVersion === 'string' ? r.noticeVersion : '01';
  const pubNo = typeof r.noticePublicationNumber === 'string' ? r.noticePublicationNumber : '';
  const desc = typeof d.beskrivelse === 'string' ? d.beskrivelse : null;
  return {
    notice_id: id || null,
    notice_version: version,
    publication_number: pubNo || null,
    title: d.titel ?? null,
    buyer: d.ordregiver ?? null,
    buyer_id: d.ordregiverIdDatavasket ?? d.ordregiverId ?? null,
    all_buyers: Array.isArray(d.alleOrdregivere) ? d.alleOrdregivere : [],
    publication_date: d.publiceringsdato ?? null, // dd-mm-yyyy as returned upstream
    cpv_code: d.cpvKode ?? null,
    cpv_title: d.cpvTitel ?? null,
    notice_type: d.formulartype ?? null,
    notice_subtype: d.bkSubType ?? null,
    is_amendment: d.erAendring ?? null,
    estimated_value: d.anslaaetVaerdi ?? null,
    estimated_value_currency: d.anslaaetVaerdiValuta ?? null,
    deadlines: Array.isArray(d.tidsfrister) ? d.tidsfrister : [],
    description: desc && desc.length > 400 ? `${desc.slice(0, 400)}…` : desc,
    url: id && pubNo ? NOTICE_URL(id, version, pubNo) : null,
  };
}

function shapePage(data: unknown, echo: Record<string, unknown>): Record<string, unknown> {
  const d = data as { resultatElementDtoList?: any[]; totaltAntalResultater?: number };
  const notices = (d.resultatElementDtoList ?? []).map(shapeListItem);
  const total = d.totaltAntalResultater ?? notices.length;
  const limit = typeof echo.limit === 'number' && echo.limit > 0 ? echo.limit : notices.length || 1;
  const cleanEcho: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(echo)) if (v !== undefined && v !== null) cleanEcho[k] = v;
  return {
    source: 'udbud.dk — official Danish national public-procurement portal (Konkurrence- og Forbrugerstyrelsen)',
    country: 'Denmark',
    total_count: total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    count: notices.length,
    ...cleanEcho,
    notices,
  };
}

// Strip an eForms HTML rendering down to readable plain text.
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- upstream fetch --------------------------------------------------------

async function udbudSearch(body: SearchBody): Promise<unknown> {
  return udbudFetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
  });
}

async function udbudGet(url: string): Promise<unknown> {
  return udbudFetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
}

async function udbudFetch(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new Error(
      aborted
        ? `udbud.dk API timed out after ${TIMEOUT_MS / 1000}s`
        : `udbud.dk API fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) {
    throw new Error(
      'udbud.dk: notice not found (404). Check notice_id, notice_version, and publication_number — all three come from dk_tender_search results.',
    );
  }
  if (!res.ok) {
    const bodyText = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    let message = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as { detail?: string; title?: string };
      if (parsed?.detail) message = parsed.detail;
      else if (parsed?.title) message = parsed.title;
    } catch { /* keep raw body */ }
    throw new Error(`udbud.dk API: HTTP ${res.status}${message ? ` — ${message}` : ''}`);
  }
  return res.json();
}

// --- helpers ---------------------------------------------------------------

function resolveType(v: string | undefined): { code: string | null } | { error: string; retry_hint: string } {
  if (!v) return { code: null };
  const trimmed = v.trim();
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
  const code = TYPE_LABELS[upper] ? upper : TYPE_ALIASES[trimmed.toLowerCase()];
  if (!code) {
    return {
      error: `Unrecognized notice_type "${v}".`,
      retry_hint: `Use one of: ${Object.entries(TYPE_LABELS).map(([c, l]) => `${c} (${l})`).join(', ')} — plain words like "award" or "national" also work.`,
    };
  }
  return { code };
}

function listArg(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => strArg(x)).filter((x): x is string => !!x);
  const s = strArg(v);
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dateArg(v: unknown): string | undefined {
  const s = strArg(v);
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : undefined;
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  let n: number;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.trunc(v);
  else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) n = Math.trunc(Number(v));
  else return dflt;
  return Math.min(max, Math.max(min, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
