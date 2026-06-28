# Trino용 Monaco 기반 SQL 에디터

> [English](./README.md) · 한국어

[Monaco Editor](https://microsoft.github.io/monaco-editor/) 기반의 React용 **Trino SQL 에디터** 컴포넌트입니다. 자체 완결적이며 워커 없이도 동작합니다: `trino` 언어는 Monaco의 오픈소스 SQL 정의(MIT)에서 적응했고, 키워드/함수 목록은 공개 [Trino 문서](https://trino.io/docs/)에서 가져왔습니다.

## 특징

- ✅ `trino` 언어 등록 (Monarch 토크나이저 + 언어 설정)
- 🎨 라이트/다크 Trino 테마
- 💡 자동완성: 내장 **키워드**, **함수**, **타입** + 선택적 비동기 **메타데이터 provider**(카탈로그/스키마/테이블/컬럼)
- ⌨️ 액션: **쿼리 실행**(`Ctrl/Cmd+Enter`), **Explain Query**, **Prettify**(`Shift+Alt+F`) — 우클릭 메뉴에도 제공
- 🧩 컴팩트한 12px 레이아웃, 미니맵 끔, overflow 위젯 고정
- 🔌 controlled/uncontrolled 모두 지원, 완전한 타입 정의(TypeScript)

## 설치

```bash
npm install
```

`react`, `react-dom`은 peer dependency이며, `@monaco-editor/react`와 `monaco-editor`는 dependency로 포함됩니다.

## 데모 실행

```bash
npm run dev      # 출력되는 localhost URL 접속
```

## 사용법

```tsx
import { TrinoEditor } from "trino-monaco";

export function MyEditor() {
  const [sql, setSql] = useState("SELECT 1");

  return (
    <TrinoEditor
      value={sql}
      onChange={setSql}
      theme="dark"
      height="400px"
      onRunQuery={(query) => console.log("RUN:", query)}
      onExplainQuery={(query) => console.log("EXPLAIN:", query)}
    />
  );
}
```

### 에디터 옵션

Monaco 옵션은 `options` prop으로 전달합니다. 패키지 기본값(`DEFAULT_EDITOR_OPTIONS` — 12px 폰트, 미니맵 끔, 8px 패딩 등) 위에 **얕은 머지**되므로 바꾸고 싶은 키만 지정하면 됩니다:

```tsx
<TrinoEditor
  theme="dark"
  height="500px"
  defaultValue="SELECT * FROM system.runtime.nodes"
  options={{
    fontSize: 14,                 // 기본 12
    lineNumbers: "relative",
    minimap: { enabled: true },   // 기본은 꺼짐
    wordWrap: "on",
    tabSize: 4,                   // 기본 2
    renderWhitespace: "boundary",
    cursorBlinking: "phase",
    scrollbar: { verticalScrollbarSize: 14 },
  }}
/>
```

주의:
- 머지는 **얕은(shallow)** 방식입니다 — `minimap` / `scrollbar` 같은 중첩 객체는 딥 머지가 아니라 통째로 교체됩니다. 다른 `scrollbar` 기본값을 유지하려면 다시 명시하세요.
- `language` / `theme`은 `options`로 넘기지 마세요. `theme` prop을 쓰세요(언어는 컴포넌트가 관리). 전체 기본값은 `src/trino/options.ts` 참고.

### 스키마 인지 자동완성

`metadataProvider`를 제공하면 카탈로그·스키마·테이블·컬럼을 노출할 수 있습니다(보통 Trino 메타데이터 API로 백킹):

```tsx
<TrinoEditor
  metadataProvider={async ({ word }) => {
    const rows = await fetchMetadata(word); // 사용자 API
    return rows.map((r) => ({ label: r.name, kind: r.kind, detail: r.type }));
  }}
/>
```

### 문맥 인지 자동완성 + 문법 검증 (ANTLR + antlr4-c3)

`contextAware`를 켜면 Web Worker가 ANTLR 문법으로 SQL을 파싱하고 [antlr4-c3](https://github.com/mike-lischke/antlr4-c3)로 — 문법의 ATN에서 — 커서 위치에 무엇이 유효한지 정확히 판별합니다. 무거운 파싱은 메인 스레드 밖([Comlink](https://github.com/GoogleChromeLabs/comlink) 경유)에서 돌아 타이핑이 매끄럽습니다. 문법 오류는 마커로 표시됩니다(`validateOnType`).

```tsx
<TrinoEditor
  contextAware
  metadataProvider={async (ctx) => {
    // ctx가 커서 위치에 문법상 무엇이 와야 하는지 알려줍니다:
    if (ctx.qualifier?.length) {
      // `alias.` -> 해당 별칭/테이블의 컬럼 해석
      const table = ctx.aliases?.find(a => a.alias === ctx.qualifier!.at(-1))?.table;
      return columnsOf(table).map(c => ({ label: c.name, kind: "column", detail: c.type }));
    }
    if (ctx.expectTable)  return (await listTables()).map(t => ({ label: t, kind: "table" }));
    if (ctx.expectColumn) return (await listColumns()).map(c => ({ label: c.name, kind: "column" }));
    return [];
  }}
/>
```

`metadataProvider` 컨텍스트는 `expectTable`, `expectColumn`, `qualifier`(예: `a.` → `["a"]`), 그리고 해석된 `aliases`(`{ alias, table }`)를 담고 있습니다. 키워드와 함수는 파서 컨텍스트로부터 자동 추가되므로, 에디터는 해당 위치에서 문법상 유효한 것만 제안합니다.

**구문 커버리지.** 완성용 문법(`src/grammar/TrinoSql.g4`)이 이해하는 범위:

- 쿼리: `SELECT`, `WITH`(CTE), 집합 연산(`UNION` / `INTERSECT` / `EXCEPT`), `VALUES`, 서브쿼리, 조인
- DML: `INSERT`, `UPDATE`, `DELETE`, `MERGE`
- DDL / 유틸: `CREATE TABLE`(`CTAS` 포함), `CREATE VIEW`, `CREATE SCHEMA`, `DROP`, `ALTER TABLE`, `TRUNCATE`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `USE`, `CALL`
- 표현식: 함수 호출, `CASE`, `CAST`, 술어, 한정명(qualified name)

기존 객체 위치(`FROM`, `DROP TABLE`, `DELETE FROM`, `UPDATE`, `INSERT INTO`, `SHOW COLUMNS FROM` 등)는 테이블 제안을, 컬럼 위치(`SELECT`, `WHERE`, `UPDATE SET`, `INSERT (cols)` 등)는 컬럼 제안을 띄웁니다. 새 객체 이름(`CREATE` 대상, 컬럼 정의)은 의도적으로 기존 객체를 제안하지 **않습니다**.

파서 재생성은 `npm run gen:parser`, 문맥 테스트는 `npm run test:core`(쿼리/DML/DDL에 걸친 23개 단언).

### Trino 클러스터에서 실시간 메타데이터

`createTrinoMetadataProvider`는 커서 컨텍스트에 답하기 위해 Trino REST 프로토콜로(`SHOW CATALOGS / SCHEMAS / TABLES / COLUMNS`) 질의하는 즉시 사용 가능한 `metadataProvider`입니다. TTL 캐시, in-flight 디듀프, 라운드별 요청 취소를 포함합니다:

```tsx
import { TrinoEditor, createTrinoMetadataProvider } from "trino-monaco";

const metadata = createTrinoMetadataProvider({
  baseUrl: "https://trino.example.com:8443",
  user: "alice",
  authorization: "Basic " + btoa("alice:secret"),
  catalog: () => session.catalog, // getter라 `USE` 변경이 반영됨
  schema: () => session.schema,
  cacheTtlMs: 5 * 60_000,
});

<TrinoEditor contextAware metadataProvider={metadata} />;
```

컨텍스트를 질의로 자동 매핑합니다:

| 커서 | 질의 |
|---|---|
| `FROM \|` | `SHOW CATALOGS` + `SHOW SCHEMAS` + `SHOW TABLES`(현재 스키마) |
| `FROM cat.\|` | `SHOW SCHEMAS FROM cat` |
| `FROM cat.sch.\|` | `SHOW TABLES FROM cat.sch` |
| `WHERE a.\|` (별칭 `a` → `orders`) | `SHOW COLUMNS FROM …orders` |
| `SELECT \| FROM t a` | in-scope 테이블별 `SHOW COLUMNS` |

전체 스위트는 `npm test`로 실행합니다(`test:core` + `test:metadata`, 후자는 모킹 fetch로 REST 프로토콜·페이지네이션·캐싱·qualifier 라우팅을 검증).

## 클러스터 연결

에디터는 Trino에 **두 지점**에서 접속합니다: 메타데이터(자동완성)는 `createTrinoMetadataProvider`로, **쿼리 실행**은 `onRunQuery`에 연결한 `createTrinoQueryRunner`로.

```tsx
import {
  TrinoEditor,
  createTrinoMetadataProvider,
  createTrinoQueryRunner,
  basicAuth,
} from "trino-monaco";

const conn = {
  baseUrl: "/trino",                         // 동일 출처 프록시 (아래 참고)
  user: "admin",
  authorization: basicAuth("admin", "secret"),
  catalog: () => "tpch",
  schema: () => "tpch",
  // Trino는 절대 nextUri URL을 반환 — 프록시로 다시 라우팅:
  rewriteNextUri: (u) => u.replace(/^https?:\/\/[^/]+/, "/trino"),
};

const metadata = createTrinoMetadataProvider(conn);
const run = createTrinoQueryRunner(conn);

<TrinoEditor
  contextAware
  metadataProvider={metadata}
  onRunQuery={async (sql) => {
    const { columns, rows } = await run(sql.replace(/;\s*$/, ""));
    renderResults(columns, rows);
  }}
/>;
```

`createTrinoQueryRunner`는 페이지를 스트리밍하고(`onPage`), `TrinoQueryError`를 표면화하며, `RunQueryOptions.signal`로 중단 시 서버측 취소(HTTP `DELETE`)도 수행합니다.

### CORS / 프록시

브라우저는 Trino에 직접 호출할 수 없고(CORS 헤더 없음), 자격증명을 들고 있어서도 안 됩니다. 자체 출처를 통해 프록시하세요. 데모는 Vite 프록시를 씁니다:

```ts
// vite.config.ts
server: {
  proxy: {
    "/trino": {
      target: process.env.VITE_TRINO_TARGET ?? "https://your-cluster:8443",
      changeOrigin: true,
      secure: false,            // 자기서명 인증서
      rewrite: (p) => p.replace(/^\/trino/, ""),
    },
  },
}
```

그다음 클러스터를 향해 데모를 실행하고 **Connect**를 누르세요:

```bash
VITE_TRINO_TARGET=https://your-cluster:8443 npm run dev
```

### 인증

Trino / Starburst Enterprise의 `/v1/statement`는 **Basic**(패스워드) 또는 **Bearer**(JWT)를 씁니다 — 웹 UI 폼 로그인 쿠키는 *아닙니다*. `basicAuth(user, pass)`를 쓰거나 `authorization: "Bearer <token>"`을 설정하세요. `createStarburstFetch`는 REST API를 웹 UI 세션 뒤로 프록시하는 드문 환경(`formLogin: true`)을 위해 제공됩니다 — 그 외에는 Basic을 권장합니다.

> 운영 환경에서는 **자체 백엔드**에서 인증을 종료하고(브라우저에 비밀번호를 두지 않기) `baseUrl`을 사용자 API로 지정하세요: `브라우저 → 내 API → Trino`.

`npm run test:live`는 실제 클러스터(`TRINO_URL`, `TRINO_USER`, `TRINO_PASS`)에 대한 end-to-end 점검을 수행합니다.

### 언어 확장

```tsx
<TrinoEditor
  languageElements={{
    functions: [...TRINO_FUNCTIONS, "my_udf"],
  }}
  formatter={(sql) => myCustomFormatter(sql)}
/>
```

## Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `value` | `string` | — | controlled 값 |
| `defaultValue` | `string` | — | uncontrolled 초기값 |
| `onChange` | `(value: string) => void` | — | 내용 변경 콜백 |
| `onRunQuery` | `(sql, editor) => void` | — | `Ctrl/Cmd+Enter` / 메뉴 |
| `onExplainQuery` | `(sql, editor) => void` | — | Explain Query 액션 |
| `theme` | `"light" \| "dark"` | `"light"` | 색상 테마 |
| `readOnly` | `boolean` | `false` | 읽기 전용 모드 |
| `languageElements` | `Partial<TrinoLanguageElements>` | 내장값 | 키워드/함수/연산자/타입 재정의 |
| `metadataProvider` | `MetadataProvider` | — | 비동기 카탈로그/스키마/테이블/컬럼 제안 |
| `formatter` | `Formatter` | 내장 | 커스텀 SQL 포매터 |
| `contextAware` | `boolean` | `false` | ANTLR/c3 워커 완성 + 검증 활성화 |
| `validateOnType` | `boolean` | `true` | 문법 오류 마커(문맥 인지 모드) |
| `options` | Monaco 옵션 | — | 기본값 위에 머지 |
| `height` / `width` | `string \| number` | `"100%"` | 에디터 크기 |
| `onMount` | `(editor, monaco) => void` | — | 탈출구(escape hatch) |

## 라이브러리 빌드

```bash
npm run build        # -> dist/ (ES 모듈 + d.ts)
npm run build:demo   # -> dist/ 정적 데모 사이트
```

## 아키텍처

```
src/
  TrinoEditor.tsx        메인 React 컴포넌트 (@monaco-editor/react 래퍼)
  index.ts               공개 export
  trino/
    language.ts          Monarch 토크나이저 + 언어 설정
    keywords.ts          키워드 / 함수 / 연산자 / 타입
    themes.ts            라이트 & 다크 테마
    options.ts           기본 에디터 옵션
    completion.ts        정적 완성 provider (+ 메타데이터 provider 타입)
    connection.ts        공유 Trino REST 클라이언트 (statement 프로토콜)
    metadata.ts          createTrinoMetadataProvider (실시간 Trino REST + 캐시)
    runner.ts            createTrinoQueryRunner (실행 + 스트리밍 + 취소)
    auth.ts              basicAuth / createStarburstFetch
    format.ts            경량 SQL 포매터
    setup.ts             Monaco에 언어/테마/완성 등록
  grammar/
    TrinoSql.g4          문맥 인지 완성용 ANTLR 문법
  generated/             ANTLR 생성 lexer/parser (npm run gen:parser)
  worker/
    completion.worker.ts Web Worker 진입점 (Comlink.expose)
    completionCore.ts    파싱 + antlr4-c3 후보 수집 (순수 로직)
    contextProvider.ts   문맥 인지 Monaco 완성 provider
    client.ts            워커 생성 + Comlink 래핑
    protocol.ts          워커/메인 공유 타입
  App.tsx / main.tsx     데모 앱
scripts/
  gen-parser.mjs         파서 재생성 + @ts-nocheck 주입
  test-core.ts           c3 완성 코어 Node 스모크 테스트
  test-metadata.ts       Trino REST 메타데이터 provider Node 테스트
  test-runner.ts         쿼리 러너 Node 테스트 (폴링/취소/스트리밍)
  test-live.ts           실제 클러스터 end-to-end 테스트 (opt-in)
```

## 출처 표기(Attribution)

- `src/trino/language.ts`의 Trino Monarch 토크나이저 및 언어 설정은 **Monaco Editor 오픈소스 SQL 언어 정의**(`microsoft/monaco-editor`, `src/basic-languages/sql/sql.ts`, MIT 라이선스)에서 적응한 것입니다 — [`NOTICE`](./NOTICE) 참고.
- 키워드/함수/연산자/타입 목록은 공개 [Trino SQL 레퍼런스 문서](https://trino.io/docs/)에서 정리한 사실 데이터입니다.
- 테마, 에디터 옵션, 완성 provider, 포매터, React 컴포넌트는 이 프로젝트의 독자 코드입니다.
- 문맥 인지 완성은 [antlr4ng](https://github.com/mike-lischke/antlr4ng)(BSD-3), [antlr4-c3](https://github.com/mike-lischke/antlr4-c3)(MIT), [Comlink](https://github.com/GoogleChromeLabs/comlink)(Apache-2.0)을 사용합니다. `src/grammar/TrinoSql.g4` 문법은 처음부터 직접 작성했습니다(Trino의 Apache-2.0 `SqlBase.g4` 구조를 참고).

## 라이선스

MIT — [`LICENSE`](./LICENSE) 참고.
