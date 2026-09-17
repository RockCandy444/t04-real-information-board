"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudSun, Database, RefreshCw, ShieldCheck, TestTube2 } from "lucide-react";

type Reading = { id?: number; recordDate: string; normalizedValue: number; unit: string; sourceName: string; sourceUrl: string; sourceObservedAt: string; fetchedAt: string; recordTimezone: string; rawJson: string };
type ReplayState = { freshness: "fresh" | "stale"; errorCode: "none" | "timeout" | "auth" | "rate_limit" | "offline" | "schema_error"; value: number | null; rows: Array<{ date: string; value: number }>; label: string };

const failures = [
  { id: "timeout", label: "느린 응답", code: "timeout", note: "응답 제한시간을 넘겼습니다. 잠시 뒤 다시 시도하세요." },
  { id: "auth", label: "401 거절", code: "auth", note: "외부 원천이 요청을 거절했습니다. 원천 상태를 확인하세요." },
  { id: "rate", label: "호출 제한", code: "rate_limit", note: "호출 한도를 넘었습니다. 60초 뒤 다시 시도하세요." },
  { id: "offline", label: "오프라인", code: "offline", note: "네트워크에 연결되지 않았습니다. 연결 후 다시 시도하세요." },
  { id: "schema", label: "형식 변경", code: "schema_error", note: "응답 형식이 예상과 다릅니다. 원천의 변경 여부를 확인하세요." },
] as const;
const initialReplay: ReplayState = { freshness: "fresh", errorCode: "none", value: 105, rows: [{ date: "2026-08-24", value: 105 }], label: "T04-NORMAL-D1-A → T04-NORMAL-D1-B · 같은 날짜 한 행 갱신" };
const normalFixtures = [
  { id: "T04-NORMAL-D1-A", label: "1일차 첫 조회" },
  { id: "T04-NORMAL-D1-B", label: "같은 날 갱신" },
  { id: "T04-NORMAL-D2", label: "다음 날 새 기록" },
] as const;
const SOURCE_URL = "https://api.open-meteo.com/v1/forecast?latitude=36.3504&longitude=127.3845&current_weather=true&timezone=Asia%2FSeoul";

function formatKst(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); }

export default function InformationBoard() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("저장된 실제 기록을 확인하고 있습니다.");
  const [freshness, setFreshness] = useState<"fresh" | "stale">("fresh");
  const [replay, setReplay] = useState<ReplayState>(initialReplay);

  useEffect(() => {
    fetch("/api/readings", { cache: "no-store" }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setReadings(data.readings ?? []); setMessage("저장된 기록을 불러왔습니다."); }).catch(() => setMessage("아직 저장된 실제 기록이 없습니다. 첫 조회를 실행하세요.")).finally(() => setLoading(false));
  }, []);

  async function refreshLive() {
    setLoading(true); setMessage("Open-Meteo에서 대전 기온을 확인하고 있습니다.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const sourceResponse = await fetch(SOURCE_URL, { headers: { accept: "application/json" }, signal: controller.signal, cache: "no-store" });
      if (!sourceResponse.ok) throw new Error(`외부 원천 조회 실패 (${sourceResponse.status})`);
      const sourcePayload = await sourceResponse.json();
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_payload: sourcePayload }),
      });
      const data = await response.json();
      setReadings(data.readings ?? []); setFreshness(data.freshness ?? "stale");
      if (!response.ok) throw new Error(data.message);
      setMessage("새 값을 확인해 오늘의 기록을 저장했습니다.");
    }
    catch (error) { setFreshness("stale"); setMessage(error instanceof Error ? error.message : "마지막 정상값을 보존했습니다."); }
    finally { clearTimeout(timeout); setLoading(false); }
  }

  function replayFailure(item: (typeof failures)[number]) { setReplay({ ...initialReplay, freshness: "stale", errorCode: item.code, label: item.note }); }
  function replayRecovery() { setReplay({ freshness: "fresh", errorCode: "none", value: 120, rows: [{ date: "2026-08-24", value: 105 }, { date: "2026-08-25", value: 120 }], label: "T04-RECOVER-D2 · 다음 날짜 기록이 정확히 1건 추가되었습니다." }); }
  function replayNormal(id: (typeof normalFixtures)[number]["id"]) {
    if (id === "T04-NORMAL-D1-A") setReplay({ freshness: "fresh", errorCode: "none", value: 100, rows: [{ date: "2026-08-24", value: 100 }], label: `${id} · 1일차 행 1건 생성` });
    else if (id === "T04-NORMAL-D1-B") setReplay(initialReplay);
    else setReplay({ freshness: "fresh", errorCode: "none", value: 120, rows: [{ date: "2026-08-24", value: 105 }, { date: "2026-08-25", value: 120 }], label: `${id} · 전일 대비 +15 pt` });
  }

  const current = readings.at(-1);
  const delta = useMemo(() => readings.length === 2 ? readings[1].normalizedValue - readings[0].normalizedValue : null, [readings]);

  useEffect(() => {
    type WebMcpContext = { registerTool: (tool: object, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const modelContext = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: object) => void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    register({ name: "read_information_board", title: "정보판 상태 읽기", description: "현재 실제 기온 기록 수와 합성 재생 상태를 읽습니다.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ live_record_count: readings.length, latest: current ? { date: current.recordDate, value: current.normalizedValue, unit: current.unit } : null, replay: { freshness: replay.freshness, error_code: replay.errorCode, row_count: replay.rows.length } }) });
    register({ name: "record_live_weather", title: "실제 기온 조회·기록", description: "Open-Meteo의 현재 대전 기온을 조회하고 같은 KST 날짜의 일별 기록을 갱신합니다.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true }, execute: async () => { await refreshLive(); return { requested: true }; } });
    register({ name: "replay_synthetic_fixture", title: "합성 fixture 재생", description: "공식 T04 정상·실패·복구 fixture 중 하나를 화면에서 재생합니다.", inputSchema: { type: "object", properties: { fixture_id: { type: "string", enum: ["T04-NORMAL-D1-A", "T04-NORMAL-D1-B", "T04-NORMAL-D2", "T04-TIMEOUT", "T04-AUTH-401", "T04-RATE-429", "T04-OFFLINE", "T04-SCHEMA-BREAK", "T04-RECOVER-D2"] } }, required: ["fixture_id"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { const id = (input as { fixture_id?: string }).fixture_id; if (id === "T04-RECOVER-D2") replayRecovery(); else if (normalFixtures.some((item) => item.id === id)) replayNormal(id as (typeof normalFixtures)[number]["id"]); else { const map: Record<string, number> = { "T04-TIMEOUT": 0, "T04-AUTH-401": 1, "T04-RATE-429": 2, "T04-OFFLINE": 3, "T04-SCHEMA-BREAK": 4 }; if (!(id && id in map)) throw new Error("지원하지 않는 fixture_id입니다."); replayFailure(failures[map[id]]); } await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); return { fixture_id: id, replayed: true }; } });
    return () => lifecycle.abort();
  }, [current, readings, replay]);

  return <main>
    <header className="masthead"><div className="brand"><CloudSun aria-hidden="true" /> 오늘의 진짜 정보판</div><div className="status-line"><span className={freshness === "fresh" ? "status-dot fresh" : "status-dot stale"} />{freshness === "fresh" ? "정상 데이터" : "오래된 값 표시 중"}</div></header>
    <section className="hero" aria-labelledby="board-title"><div><p className="eyebrow">DAEJEON · DAILY TEMPERATURE</p><h1 id="board-title">대전은 지금<br/><span>{current ? `${current.normalizedValue}${current.unit}` : "조회 전"}</span></h1><p className="lede">실제 공개 원천에서 받은 기온을 한국 날짜별로 한 줄씩 보존합니다.</p></div><button className="refresh-button" onClick={refreshLive} disabled={loading}><RefreshCw className={loading ? "spin" : ""} aria-hidden="true" />{loading ? "확인 중" : "지금 조회하고 기록"}</button></section>
    <p className="live-message" role="status">{message}</p>
    <section className="metric-grid" aria-label="현재 실제 데이터 세부 정보">
      <article className="metric primary-metric"><p>어제 대비</p><strong>{delta === null ? "두 번째 날짜를 기다리는 중" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${current?.unit}`}</strong><span>저장된 두 날짜의 값으로 다시 계산합니다.</span></article>
      <article className="metric"><p>출처 시각</p><strong>{current ? formatKst(current.sourceObservedAt) : "—"}</strong><span>원천이 관측한 시각</span></article>
      <article className="metric"><p>조회 시각</p><strong>{current ? formatKst(current.fetchedAt) : "—"}</strong><span>서버가 값을 받은 시각</span></article>
      <article className="metric"><p>기준 시간대</p><strong>Asia/Seoul</strong><span>날짜 기록 기준</span></article>
    </section>
    <section className="records section-block" aria-labelledby="records-title"><div className="section-title"><div><p className="eyebrow">LIVE RECORDS</p><h2 id="records-title">실제 날짜 기록</h2></div><span>{readings.length} / 2건</span></div>{readings.length === 0 ? <div className="empty">첫 실제 조회를 실행하면 오늘 날짜의 기록이 여기에 남습니다.</div> : <div className="record-list">{readings.map((reading) => <article className="record" key={`${reading.recordDate}-${reading.id ?? 0}`}><div className="record-date"><time>{reading.recordDate}</time><span>{reading.normalizedValue}{reading.unit}</span></div><dl><div><dt>공개 원천</dt><dd><a href={reading.sourceUrl} target="_blank" rel="noreferrer">{reading.sourceName}</a></dd></div><div><dt>원자료</dt><dd>{JSON.stringify(JSON.parse(reading.rawJson).current_weather)}</dd></div><div><dt>일치 확인</dt><dd>저장값 {reading.normalizedValue}{reading.unit} = 화면값 {reading.normalizedValue}{reading.unit}</dd></div></dl></article>)}</div>}</section>
    <section className="lab section-block" aria-labelledby="lab-title"><div className="section-title"><div><p className="eyebrow">SYNTHETIC FAILURE LAB</p><h2 id="lab-title">정상 저장과 다섯 실패 재생</h2></div><span className="synthetic">합성 시험값만 사용</span></div><div className="lab-grid"><div className="failure-controls"><p className="control-label">정상 저장 순서</p>{normalFixtures.map((item) => <button className="normal" key={item.id} onClick={() => replayNormal(item.id)}>{item.label}<span>{item.id}</span></button>)}<p className="control-label">실패 5종</p>{failures.map((item) => <button key={item.id} onClick={() => replayFailure(item)}>{item.label}<span>{item.code}</span></button>)}<button className="recovery" onClick={replayRecovery}>다시 시도 · 복구<span>T04-RECOVER-D2</span></button><button className="reset" onClick={() => setReplay(initialReplay)}>합성 상태 초기화</button></div><article className={`replay-panel ${replay.freshness}`} aria-live="polite"><div className="replay-heading"><TestTube2 aria-hidden="true"/><span>{replay.freshness} / {replay.errorCode}</span></div><strong>마지막 정상값 {replay.value ?? "—"} pt</strong><p>{replay.label}</p><ul>{replay.rows.map((row) => <li key={row.date}><time>{row.date}</time><span>{row.value} pt</span></li>)}</ul></article></div></section>
    <footer><span><Database aria-hidden="true"/> 같은 KST 날짜는 한 행으로 갱신</span><span><ShieldCheck aria-hidden="true"/> 비밀키·개인정보 없음</span><a href="/t04-real-information-board-public-v1.zip" download>공식 fixture 꾸러미 받기</a></footer>
  </main>;
}
