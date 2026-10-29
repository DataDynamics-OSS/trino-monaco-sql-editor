# Trino Monaco SQL Editor — 설계 문서

> 상태: **v0.1** (`package.json` 0.1.0) · 인증: 직접 연결(Basic/Bearer) 또는 사용자별 게이트웨이 세션 · 공개 저장소: [`DataDynamics-OSS/trino-monaco-sql-editor`](https://github.com/DataDynamics-OSS/trino-monaco-sql-editor)
>
> 목표: Monaco Editor 위에 **Trino SQL** 전용 React 컴포넌트(`trino-monaco`)를 만든다. Monarch 토크나이저, ANTLR + antlr4-c3 워커 기반 문맥 자동완성, Trino REST 메타데이터 프로바이더, 쿼리 러너, 내장 도움말, 다국어 UI, 사용자별 세션 게이트웨이를 제공한다. 이 문서는 현재 구현을 기준으로 구조와 결정 사항을 정리한다.

---

## 1. 배경과 범위

### 1.1 Trino의 특성 (설계 전제)

1. **HTTP 프로토콜**: Trino 클라이언트 프로토콜은 HTTP REST다. `POST /v1/statement` 로 시작해 응답의 `nextUri` 를 `GET` 으로 따라가며 `QUEUED → RUNNING → FINISHED` 페이지를 받는다. 따라서 브라우저에서도 원리상 직접 호출할 수 있다. 다만 CORS 허용과 자격 증명 보관이 문제이므로 같은 출처의 프록시나 게이트웨이를 둔다 (§8).
2. **요청마다 인증**: Trino는 연결 단위가 아니라 **HTTP 요청마다** 인증한다(Basic 비밀번호 인증 또는 Bearer JWT/OAuth). 그래서 세션 동안 쓸 자격 증명을 누군가는 들고 있어야 한다.
3. **세션 상태는 클라이언트 책임**: `USE`, `SET SESSION`, `PREPARE`, `START TRANSACTION` 의 결과는 서버가 저장하지 않는다. 응답 헤더(`X-Trino-Set-Catalog`, `X-Trino-Set-Session`, `X-Trino-Added-Prepare`, `X-Trino-Started-Transaction-Id` …)로 돌려주고, 클라이언트가 다음 요청 헤더에 다시 실어 보내야 유지된다.
4. **3단계 이름**: 객체는 `catalog.schema.table` 이다. 메타데이터는 `SHOW CATALOGS / SCHEMAS / TABLES / COLUMNS` 로 조회한다.
5. **식별자 케이스**: 비인용 식별자는 소문자로 정규화된다. 키워드는 대소문자를 구분하지 않는다.

### 1.2 Non-goals (v1)

- Trino 전체 문법 수준의 검증 — 자동완성용 축약 문법만 둔다 (§6.1). 정확한 검증은 서버 실행 결과에 맡긴다.
- 문장 분리기·스크립트 실행 — `Ctrl/Cmd+Enter` 는 선택 영역 또는 문서 전체를 한 번에 실행한다. 여러 문장을 순서대로 실행하는 기능은 없다.
- 결과 그리드, 쿼리 히스토리, 카탈로그 브라우저 UI — 호스트 앱 책임 (데모 수준만 제공).

---

## 2. 전체 아키텍처

```
┌──────────────────────────── Browser ─────────────────────────────┐
│                                                                  │
│  <TrinoEditor/> (React)                                          │
│   ├─ setupTrino(monaco) ─ language / Monarch / themes            │
│   ├─ Actions: Run query · Explain Query · Prettify · Show Help   │
│   ├─ Hover (내장 도움말: 함수 / 키워드 / 타입)                     │
│   │                                                              │
│   ├─ Completion Provider ──Comlink──▶ completion.worker          │
│   │        │                          ├ TrinoSqlLexer/Parser     │
│   │        │                          ├ antlr4-c3 core           │
│   │        │                          └ alias 수집 / 문법 검증    │
│   │        ▼                                                     │
│   │   MetadataProvider (SHOW … + TTL 캐시)                        │
│   │        │                                                     │
│   └─ QueryRunner ──────────┐                                     │
│                            ▼                                     │
│            TrinoConnectionOptions (baseUrl, fetch, headers …)    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS — Trino 클라이언트 프로토콜
          ┌──────────────────┴────────────────────┐
          ▼                                       ▼
  [A] 같은 출처 프록시 (/trino)          [B] trino-monaco gateway (/api)
      브라우저가 Basic/Bearer 보관           사용자별 세션, 쿠키 인증
          │                                       │  세션 상태 유지
          ▼                                       ▼  (USE / SET SESSION / 트랜잭션)
                         Trino / Starburst 클러스터
```

핵심 원칙:

- **연결은 `TrinoConnectionOptions` 하나로 추상화한다.** `baseUrl`, `fetch`, `headers`, `rewriteNextUri`, `catalog`/`schema` getter만 바꾸면 직접 연결·프록시·게이트웨이를 같은 메타데이터 프로바이더와 러너로 쓸 수 있다.
- **무거운 파싱은 워커에서.** ANTLR 파서와 antlr4-c3 는 Web Worker 안에서만 로드되고, 메인 스레드는 `protocol.ts` 의 타입만 공유한다.
- **정적 데이터로 오프라인 동작.** 키워드·함수·타입·도움말·번역은 번들에 포함되어 클러스터 없이도 자동완성과 도움말이 동작한다.

---

## 3. 레포 / 패키지 구조

```
trino-monaco-sql-editor/
  docs/
    DESIGN.md                 ← 본 문서
  src/
    index.ts                  공개 API
    TrinoEditor.tsx           React 컴포넌트
    trino/
      language.ts             Monarch 토크나이저 + language configuration
      keywords.ts             키워드 / 함수 / 연산자 / 타입
      themes.ts               trino-light / trino-dark
      options.ts              DEFAULT_EDITOR_OPTIONS
      setup.ts                setupTrino()
      completion.ts           정적 completion provider (+ MetadataProvider 타입)
      format.ts               경량 포매터 + splitSegments (문자열/주석 구분)
      docs.ts                 내장 도움말 (함수 / 키워드·문장 / 타입, 문서 링크)
      hover.ts                도움말 hover provider, helpAt()
      i18n/                   UI 언어 (en / ko / ja / zh) + 도움말 번역
      fonts.ts                추천 에디터 글꼴
      connection.ts           Trino REST 클라이언트 (statementPages / runStatement)
      metadata.ts             createTrinoMetadataProvider (SHOW … + 캐시)
      runner.ts               createTrinoQueryRunner (스트리밍 / 취소)
      auth.ts                 basicAuth / createStarburstFetch
      gateway.ts              createTrinoGatewayClient (게이트웨이 로그인 / 세션 연결)
    grammar/
      TrinoSql.g4             자동완성용 축약 문법
    generated/                antlr4ng 생성물 (npm run gen:parser)
    worker/
      protocol.ts             CaretContext 등 공유 타입
      completionCore.ts       파싱 + c3 + 별칭 수집 + 검증 (순수 로직)
      completion.worker.ts    Comlink.expose
      client.ts               워커 생성 / 래핑
      contextProvider.ts      문맥 기반 Monaco completion provider
    App.tsx / main.tsx        데모 (appStrings.ts: 데모 문구, fonts.ts: 번들 글꼴)
  servers/                    게이트웨이 — 3개 모두 같은 HTTP API (§8.3, §15.3)
    server-node/              Fastify (API·보안 기준 문서)
    server-python/            FastAPI + httpx (trino_monaco_gateway/)
    server-java/              Spring Boot 4 + java.net.http (com.datadynamics.trinomonaco.gateway)
  scripts/
    gen-parser.mjs  check-doc-links.ts
    test-core.ts  test-metadata.ts  test-runner.ts  test-format.ts  test-docs.ts
    test-gateway-client.ts  test-live.ts
```

---

## 4. 언어 정의 (Monarch 토크나이저)

`trino/language.ts` — Monaco 기본 SQL 정의(MIT)를 Trino에 맞게 고친 것이다.

| 항목 | 처리 |
|---|---|
| 언어 ID | `trino` |
| 문자열 | `'...'`, `''` 이스케이프 |
| 인용 식별자 | `"..."`, `""` 이스케이프 → `identifier` |
| 주석 | `--`, `/* */` |
| 숫자 | 정수·소수·지수, `0x…` |
| 괄호 | `()` (배열 리터럴 `ARRAY[...]` 의 `[]` 포함) |
| 키워드 / 함수 / 연산자 | `setupTrino()` 가 `languageElements` 로 Monarch 목록을 채운다 |

### 4.1 키워드 데이터 (`trino/keywords.ts`)

```ts
export interface TrinoLanguageElements {
  keywords: string[];   // 예약어 + 비예약 키워드 (Trino 문법 기준)
  functions: string[];  // 집계 / 윈도 / 배열·맵 / 문자열 / 날짜 / 수학 / JSON / 조건·변환
  operators: string[];  // AND, OR, NOT, IN, LIKE, BETWEEN, IS …
  types: string[];      // BIGINT, VARCHAR, DECIMAL, TIMESTAMP, ARRAY, MAP, ROW …
}
```

- 출처: Trino 공식 문서(SQL 문장 문법, 예약어 목록, 함수 레퍼런스)의 사실 데이터.
- `languageElements` prop 으로 일부만 덮어쓸 수 있다 (예: 카탈로그 전용 UDF 추가).

---

## 5. 포매터 (`trino/format.ts`)

- 경량·보수적 포매터다. 공백을 정리하고, 주요 절(`SELECT`, `FROM`, `WHERE`, `GROUP BY`, `LEFT JOIN`, `UNION ALL`, `INSERT INTO` …) 앞에서 줄을 바꾸며 절 키워드를 대문자로 쓴다.
- 먼저 `splitSegments()` 로 텍스트를 **코드 / 문자열 / 인용 식별자 / 줄 주석 / 블록 주석**으로 나누고, 코드 구간만 고친다. 그래서 문자열·주석 안의 키워드나 공백은 바뀌지 않고, `--` 주석 뒤 줄바꿈도 유지된다.
- 절 줄바꿈은 긴 것부터 맞추는 정규식 한 번으로 처리한다. 그래서 `LEFT JOIN`, `DELETE FROM` 이 `LEFT\nJOIN` 처럼 쪼개지지 않는다.
- `splitSegments()` 는 호버(§9)도 문자열·주석 안인지 판단할 때 재사용한다.
- 교체 가능: `formatter` prop (예: 서버 측 포매터 위임).

---

## 6. 문맥 자동완성 (ANTLR + antlr4-c3 워커)

### 6.1 문법 전략

| 옵션 | 장점 | 단점 | 결정 |
|---|---|---|---|
| Trino 공식 `SqlBase.g4` 그대로 사용 | 커버리지 최대 | 규칙 수가 많아 c3 후보 수집이 느리고 생성 파서가 큼, 선호 규칙을 넣으려면 대폭 수정 필요 | ✗ |
| **축약 문법 직접 작성** | 빠름, 선호 규칙을 원하는 위치에 정확히 배치 | 커버리지 수동 확장 | **✓ 채택** |

`grammar/TrinoSql.g4` (`caseInsensitive = true`)는 Trino `SqlBase.g4` 의 구조(문장 → 쿼리 → 관계 → 표현식)를 참고해 처음부터 작성했다 (Apache-2.0 원본은 복사하지 않음).

- **문장**: 쿼리, `INSERT`, `DELETE`, `UPDATE`, `MERGE`, `CREATE TABLE / VIEW / SCHEMA`, `DROP`, `ALTER TABLE`, `TRUNCATE`, `SHOW …`, `DESCRIBE`, `USE`, `CALL`, `EXPLAIN`.
- **쿼리**: `WITH`, `SELECT [DISTINCT]`, 집합 연산, 서브쿼리, `JOIN … ON / USING`, `UNNEST`, `VALUES`, `GROUP BY` / `HAVING` / `ORDER BY` / `LIMIT` / `OFFSET` / `FETCH FIRST`.
- **표현식**: 함수 호출, `CASE`, `CAST` / `TRY_CAST`, `INTERVAL` 및 타입 리터럴(`DATE '…'`, `TIMESTAMP '…'`), 비교·논리 연산.

### 6.2 선호 규칙 (preferred rules)

| 규칙 | 등장 위치 예 | 제안 대상 |
|---|---|---|
| `tableRef` | `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `DELETE FROM`, `MERGE INTO`, `DROP TABLE`, `TRUNCATE TABLE`, `SHOW COLUMNS FROM`, `DESCRIBE` | 카탈로그, 스키마, 테이블 |
| `columnRef` | SELECT 목록, `WHERE`, `SET`, `ON`, `INSERT (cols)`, `ALTER TABLE … DROP / RENAME COLUMN` | 컬럼, 별칭 |
| `functionName` | 표현식 위치 | 내장 함수 |

새 객체 이름(CREATE 대상, 컬럼 정의, 별칭)은 일반 `identifier` 를 써서 기존 객체 제안이 나오지 않게 한다.

### 6.3 CaretContext (`worker/protocol.ts`)

```ts
export interface CaretContext {
  keywords: string[];       // 캐럿 위치에서 문법상 유효한 키워드
  expectTable: boolean;     // tableRef 후보
  expectColumn: boolean;    // columnRef 후보
  expectFunction: boolean;  // functionName 후보
  qualifier: string[];      // `a.` → ["a"], `cat.sch.` → ["cat", "sch"]
  partialWord: string;      // 캐럿 앞 입력 중인 단어
  aliases: AliasInfo[];     // { alias, table } — 파스 트리의 aliasedRelation
}
```

### 6.4 completionCore 처리 흐름

```
getCaretContext(text, position)
  1. 문서 전체를 lex/parse (TrinoSqlParser.root)
  2. 캐럿 토큰 인덱스 계산
  3. CodeCompletionCore.collectCandidates → 키워드 + 선호 규칙
     (식별자·리터럴·구두점 토큰은 ignoredTokens)
  4. analyzePrefix → partialWord, qualifier (`a.b.` 체인)
  5. collectAliases(tree) → aliases
validateGrammar(text) → ANTLR 오류 목록 (line, column, endColumn, message)
```

### 6.5 Monaco 제안 조합 (`contextProvider.ts`)

| sortText | 항목 |
|---|---|
| `0-` | 범위 안의 테이블 별칭 (`alias · table`) |
| `1-` | 메타데이터 (카탈로그 / 스키마 / 테이블 / 컬럼) |
| `2-` | 내장 함수 (`fn($0)` 스니펫, 도움말 문서 포함) |
| `3-` | 문법상 유효한 키워드 (입력 케이스에 맞춤) |

- qualifier 가 있으면(`a.|`) 별칭·함수·키워드를 빼고 메타데이터만 제안한다.
- 키워드 케이스는 입력 중인 단어를 따른다 (`matchCase`: 입력이 없거나 전부 대문자면 대문자, 아니면 소문자).
- 같은 라벨은 먼저 나온 것만 남긴다.
- 정적 provider(`contextAware=false`)는 함수(`2-`)·키워드(`3-`)·타입(`4-`)·메타데이터(`1-`)를 문맥 없이 모두 제안한다.

### 6.6 문법 검증 마커

- `contextAware` 이고 `validateOnType` 이 켜져 있으면 입력 후 250ms 디바운스로 `validateGrammar` 를 호출해 마커(owner `trino`)를 단다.
- 축약 문법이라 지원하지 않는 구문은 오류로 보일 수 있다. 정확한 판단은 서버 실행 결과로 한다.
- 메시지는 ANTLR 영문 메시지(`mismatched input … expecting …` 등)이며, 메인 스레드에서 `localizeMessage()` 가 패턴을 맞춰 번역한다 (§10).

---

## 7. 메타데이터 프로바이더 (`trino/metadata.ts`)

### 7.1 인터페이스

```ts
export interface TrinoMetadataItem {
  label: string;
  kind: "catalog" | "schema" | "table" | "column" | "view";
  detail?: string;          // "bigint · orders"
  documentation?: string;
  insertText?: string;
}

export interface MetadataProviderContext {
  text: string;
  position: { line: number; column: number };
  word: string;
  expectTable?: boolean;
  expectColumn?: boolean;
  qualifier?: string[];
  aliases?: { alias: string; table: string }[];
}

export type MetadataProvider = (ctx: MetadataProviderContext) => TrinoMetadataItem[] | Promise<TrinoMetadataItem[]>;
```

호스트가 직접 구현해도 되고, `createTrinoMetadataProvider(connectionOptions)` 를 쓰면 실제 클러스터에서 조회한다.

### 7.2 문맥 → 조회 매핑

| Caret | 조회 |
|---|---|
| `FROM \|` | `SHOW CATALOGS` + 현재 카탈로그의 `SHOW SCHEMAS` + 현재 스키마의 `SHOW TABLES` (각각 독립 실패 허용) |
| `FROM cat.\|` | `cat` 이 카탈로그면 `SHOW SCHEMAS FROM cat`, 아니면 현재 카탈로그의 스키마 `cat` 의 테이블 |
| `FROM cat.sch.\|` | `SHOW TABLES FROM cat.sch` |
| `WHERE a.\|` (별칭 `a` → `orders`) | `SHOW COLUMNS FROM …orders` |
| `SELECT \| FROM t a, u b` | 범위 안 모든 테이블의 `SHOW COLUMNS` (병렬, 부분 실패 허용) |

- 식별자는 항상 `"…"` 로 인용해 SQL 에 넣는다 (`""` 이스케이프).
- 현재 카탈로그/스키마는 `catalog` / `schema` 옵션(문자열 또는 getter)에서 읽는다. getter 를 쓰면 `USE` 같은 변경이 바로 반영된다. 게이트웨이 클라이언트는 이 getter 를 세션 상태에 연결한다 (§8.4).

### 7.3 캐시 정책

- 쿼리 텍스트를 키로 하는 TTL 캐시 (`cacheTtlMs`, 기본 5분, 0 이면 끔).
- 같은 쿼리가 진행 중이면 그 Promise 를 공유한다 (in-flight dedupe).
- 새 자동완성 라운드가 시작되면 이전 라운드의 요청을 `AbortController` 로 취소한다.
- 실패한 목록 조회는 빈 배열로 대체해 다른 결과를 막지 않는다 (`safe()`).

---

## 8. 연결 계층

### 8.1 `TrinoConnectionOptions` 와 프로토콜 클라이언트 (`trino/connection.ts`)

```ts
export interface TrinoConnectionOptions {
  baseUrl: string;                                    // "/trino", "https://host:8443", "/api/sessions/:id"
  user?: string;                                      // X-Trino-User (기본 "trino")
  authorization?: string;                             // "Basic …" / "Bearer …"
  source?: string;                                    // X-Trino-Source (기본 "trino-monaco")
  catalog?: string | (() => string | undefined);
  schema?: string | (() => string | undefined);
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  rewriteNextUri?: (uri: string) => string;           // 절대 nextUri → 프록시 경로
  fetch?: typeof fetch;
}
```

- `statementPages()` 는 `POST /v1/statement` 후 `nextUri` 를 따라가며 페이지를 하나씩 내보낸다 (반복 상한 100,000). `runStatement()` 는 끝까지 모아 `{ id, columns, rows }` 를 돌려준다.
- 페이지의 `error.message` 는 그대로 예외 메시지가 된다. 게이트웨이 오류(`{ error: { code, message } }`)도 같은 필드라 같은 경로로 처리된다.

### 8.2 구현 A — 직접 연결 / 같은 출처 프록시

- 브라우저가 `authorization` 을 들고 `/trino` 같은 같은 출처 프록시로 호출한다. Trino 는 절대 URL `nextUri` 를 돌려주므로 `rewriteNextUri` 로 프록시 경로로 바꾼다.
- 데모의 Vite 프록시는 `WWW-Authenticate` 응답 헤더를 지워 브라우저의 기본 Basic 인증 팝업을 막는다.
- `auth.ts`: `basicAuth(user, password)`, `createStarburstFetch()`. 표준 Trino/Starburst 의 `/v1/statement` 는 웹 UI 로그인 쿠키(`Trino-UI-Token`)를 받지 않으므로 Basic 또는 Bearer 가 기본 경로다. `formLogin` 모드는 웹 UI 세션 뒤로 REST API 를 프록시하는 배포 전용이다.
- 단점: 브라우저 메모리에 비밀번호가 있고, 사용자별 세션 상태(`USE` 등)를 클라이언트가 유지해야 한다.

### 8.3 구현 B — 게이트웨이 (`servers/`) — 여러 사용자가 쓰는 배포에 권장

- **사용자별 세션**: 사용자는 **자기 Trino 계정**으로 `POST /api/sessions` 에 한 번 로그인한다. 게이트웨이는 클러스터에서 `SELECT 1` 로 자격 증명을 확인하고(`/v1/info` 로 버전 조회), 세션 id 를 `httpOnly; Secure; SameSite=Strict` 쿠키로 발급한다. Trino 권한·리소스 그룹·감사가 사용자 단위로 적용된다.
- **프로토콜 중계**: `POST /api/sessions/:id/v1/statement`, `GET|DELETE /api/sessions/:id/v1/statement/{queued|executing}/…` 를 클러스터로 전달한다. 응답의 `nextUri` 는 게이트웨이 경로로 바꾸고 `partialCancelUri` 는 지운다. 그 밖의 페이지 내용(쿼리 오류 포함)은 그대로 전달한다.
- **세션 상태 유지**: `X-Trino-Set-Catalog/-Schema`, `-Set-Session/-Clear-Session`, `-Added-Prepare/-Deallocated-Prepare`, `-Started-Transaction-Id/-Clear-Transaction-Id` 응답 헤더로 세션을 갱신한다. 다음 문장에 `X-Trino-Catalog/-Schema/-Session/-Prepared-Statement/-Transaction-Id` 로 보낸다 (Trino CLI 와 같은 동작). 상태 헤더는 클라이언트에도 그대로 돌려준다.
- 엔드포인트:

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/aliases` | 설정된 클러스터 `[{ alias, label }]` |
| `POST` | `/api/sessions` | 로그인 `{ connectAlias, user, password }` → 세션 + 쿠키 |
| `GET` | `/api/sessions/:id` | `{ user, version, connectAlias, catalog?, schema?, inTransaction }` |
| `DELETE` | `/api/sessions/:id` | 로그아웃: 실행 중 쿼리 취소, 열린 트랜잭션 ROLLBACK |
| `POST` | `/api/sessions/:id/v1/statement` | SQL 본문 → Trino 페이지 |
| `GET` / `DELETE` | `/api/sessions/:id/v1/statement/{queued\|executing}/…` | 다음 페이지 / 취소 |

- 보안:
  - Trino 는 요청마다 인증하므로 게이트웨이는 세션 동안 자격 증명을 **메모리에만** 둔다. 로그·디스크에는 남기지 않고, 로그아웃·유휴 종료 시 버린다. 브라우저에는 쿠키만 남는다.
  - 접속 대상은 서버 설정(`TRINO_CLUSTERS`)의 별칭으로만 고른다. 클라이언트는 URL 을 보낼 수 없다.
  - 클라이언트의 `X-Trino-User`·`Authorization` 은 전달하지 않는다. 허용된 `X-Trino-*` 헤더만 전달한다.
  - 후속 요청은 `^(queued|executing)/{queryId}/{slug}/{token}$` 형식이면서 **같은 세션이 시작한 쿼리**만 허용한다. 나머지는 `404 QUERY_NOT_FOUND`.
  - 로그인 실패 rate limit(클라이언트 주소 + 별칭 + 사용자, 기본 1분 5회), 사용자당 세션 수(기본 3), 유휴 타임아웃(기본 30분, 접근 시에도 즉시 판정), 요청 타임아웃(기본 300초), DDL 차단 옵션(`ALLOW_DDL=false`, `EXPLAIN ANALYZE` 안쪽까지 검사).
  - 클러스터가 이후 자격 증명을 거부하면(401) 세션을 버리고 `SESSION_LOST` 를 돌려준다.
- API 와 보안 모델의 기준 문서는 `servers/server-node/README.md` 이다.

### 8.4 게이트웨이 클라이언트 (`trino/gateway.ts`)

```ts
const gw = createTrinoGatewayClient({ baseUrl: "/api" });
const session = await gw.login({ connectAlias: "dev", user, password });
const conn = gw.connection(session);        // TrinoConnectionOptions
const runner = createTrinoQueryRunner(conn);
const metadata = createTrinoMetadataProvider(conn);
await gw.logout(session);
```

- `connection()` 은 `baseUrl` 을 `/api/sessions/:id` 로 두고, `catalog` / `schema` getter 를 세션 객체에 연결한다. 감싼 `fetch` 가 게이트웨이가 돌려준 `X-Trino-Set-Catalog/-Schema`, 트랜잭션 헤더를 읽어 세션 객체를 갱신한다. 그래서 `USE` 뒤 메타데이터 조회가 새 스키마를 쓴다.
- 브라우저 밖(Node)에서는 `baseUrl` 을 절대 URL 로 주고 `headerAuth: true`(게이트웨이 `ALLOW_HEADER_AUTH=true`)로 `X-Session-Id` 를 보낸다. 게이트웨이가 돌려주는 경로형 `nextUri` 에는 origin 을 붙인다.
- 오류는 `TrinoGatewayError { code, status }` 로 던진다.

---

## 9. 실행 계층 (`trino/runner.ts`)

```ts
export type TrinoQueryRunner = (sql: string, options?: {
  signal?: AbortSignal;                                   // 취소 (클라이언트 + 서버)
  onPage?: (page: { columns: TrinoColumn[]; rows: unknown[][] }) => void;
}) => Promise<{ id?: string; columns: TrinoColumn[]; rows: unknown[][] }>;

export class TrinoQueryError extends Error { queryId?: string }
```

- 데이터 페이지가 올 때마다 `onPage` 로 넘겨 큰 결과도 점진적으로 그릴 수 있다.
- `signal` 이 abort 되면 진행 중 fetch 를 중단하고, 마지막 `nextUri` 에 `DELETE` 를 보내 서버에서도 쿼리를 취소한다.
- 페이지에 `error` 가 있으면 `TrinoQueryError`(쿼리 id 포함)를 던진다.
- 에디터는 실행 방법을 모른다. `onRunQuery(sql, editor)` / `onExplainQuery(sql, editor)` 콜백으로 선택 영역(없으면 문서 전체) 텍스트만 넘기고, 러너 호출은 호스트가 한다.

---

## 10. 내장 도움말과 다국어

### 10.1 내장 도움말 (`trino/docs.ts`, `trino/hover.ts`)

- 항목: 내장 함수 전부(`keywords.ts` 의 함수 목록, 집계·윈도 구분), 문장·절·연산자 토픽 약 70개, 데이터 타입. 모두 283개다. 각 항목에 문법, 설명, 예제(일부), Trino 문서 링크(`trino.io/docs/current/{page}.html#{anchor}`)가 있다. 설명과 예제는 이 에디터용으로 새로 썼다(문서 본문 복사 아님).
- 여는 방법: 마우스 hover, `Shift+F1`(Show Help 액션), `Ctrl/Cmd+Click`. 별도 패널 없이 Monaco hover 를 쓴다. `hover={false}` 여도 `help` 가 켜져 있으면 2초 안의 도움말 요청에는 응답한다.
- 조회 규칙 (`docFor(word, { next, call })`):
  - 뒤에 `(` 가 오면 함수. 단, `FILTER (WHERE …)` 는 집계 `FILTER` 절이다.
  - 다음 단어들로 토픽을 고른다: `GROUP BY`, `CREATE TABLE` vs `CREATE TABLE … AS`, `CREATE [OR REPLACE] VIEW`, `DROP MATERIALIZED VIEW`, `IS [NOT] NULL` vs `IS [NOT] DISTINCT FROM`, `NOT IN/BETWEEN/LIKE`, `WITH RECURSIVE`, `AT TIME ZONE`, `SHOW …`, `EXPLAIN ANALYZE`, `SET SESSION`.
  - `WITH TIME ZONE`, `WITH (props)`, `WITH ORDINALITY` 는 CTE 가 아니다. `OR REPLACE` 의 `REPLACE` 처럼 괄호 없는 함수 이름은 함수로 보지 않는다 (`current_date` 등 괄호 없이 쓰는 함수는 예외).
  - 그다음 타입(`DATE` 는 `(` 가 있으면 함수, 없으면 타입).
- `helpAt(text, offset)` 은 문자열·인용 식별자·주석 안(§5 `splitSegments`)과 한정 이름(`t.count`, `year.x`)에는 도움말을 내지 않는다.
- 함수 자동완성 항목에도 같은 도움말이 `documentation` 으로 붙는다.
- `npm run check:doc-links` 로 링크된 60개 페이지와 앵커가 실제로 있는지 확인한다 (네트워크 필요, `npm test` 에는 미포함).

### 10.2 다국어 (`trino/i18n/`)

- `locale` prop: `en` / `ko` / `ja` / `zh`.
- 번역 대상: 액션 라벨, 도움말의 종류·제목·설명, 자동완성 detail(`function` / `keyword` / `type` / 별칭), 문법 검증 메시지.
- 도움말 번역은 `TrinoDocEntry.id`(`fn:count`, `topic:GROUP_BY`, `type:VARCHAR`)를 키로 쓰고, 빠진 항목은 영어로 대체한다. 제목은 산문이 들어간 두 토픽(`OVER (…)`, `FILTER (…)`)만 번역한다.
- 문법 메시지는 워커가 영어로 만들고, 메인 스레드의 `localizeMessage()` 가 ANTLR 메시지 패턴(`mismatched input`, `extraneous input`, `missing … at`, `no viable alternative`, `token recognition error`)을 맞춰 번역한다. 워커 프로토콜은 바뀌지 않는다.
- 번역하지 않는 것: SQL·문법 요약·예제, Trino 서버 오류, Monaco 기본 메뉴. 문서 링크는 영어판으로 연결한다.
- `locale` 이 바뀌면 액션을 다시 등록해 라벨을 갱신하고 문법 검증을 다시 실행한다.
- `test:docs` 가 세 언어 모두 전 항목을 번역했는지, 백틱 코드 구간이 그대로인지 확인한다.

### 10.3 에디터 글꼴 (`trino/fonts.ts`)

- `TRINO_EDITOR_FONTS`: D2Coding Ligature(기본, 한글 + 합자), JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono.
- 라이브러리는 글꼴 이름(`fontFamily`)만 지정하고 파일은 호스트가 로드한다 (데모는 npm 의 `d2coding`, `@fontsource/*` 를 번들). 웹 글꼴은 Monaco 가 대체 글꼴로 글자 폭을 잰 뒤에 로드되므로, `document.fonts.load()` 후 `monaco.editor.remeasureFonts()` 로 다시 잰다.

---

## 11. React 컴포넌트 (`TrinoEditor.tsx`)

### 11.1 Props

| Prop | Type | Default | 비고 |
|---|---|---|---|
| `value` / `defaultValue` / `onChange` | | | controlled / uncontrolled |
| `onRunQuery` | `(sql, editor) => void` | — | `Ctrl/Cmd+Enter` — 선택 영역, 없으면 문서 전체 |
| `onExplainQuery` | `(sql, editor) => void` | — | Explain Query 액션 |
| `theme` | `"light" \| "dark"` | `"light"` | |
| `readOnly` | `boolean` | `false` | |
| `languageElements` | `Partial<TrinoLanguageElements>` | 내장 | |
| `metadataProvider` | `MetadataProvider` | — | |
| `formatter` | `Formatter` | 내장 | |
| `contextAware` | `boolean` | `false` | ANTLR/c3 워커 (마운트 시 1회 읽음) |
| `validateOnType` | `boolean` | `true` | 문법 오류 마커 (`contextAware` 일 때) |
| `locale` | `"en" \| "ko" \| "ja" \| "zh"` | `"en"` | |
| `hover` | `boolean` | `true` | 마우스 hover 도움말 |
| `help` | `boolean` | `true` | `Shift+F1` / `Ctrl/Cmd+Click` 도움말 |
| `fontFamily` / `fontLigatures` | `string` / `boolean` | D2Coding Ligature / `true` | |
| `options` / `height` / `width` / `className` / `onMount` | | | |

### 11.2 액션 / 키바인딩

| 액션 ID | 라벨 (en) | 키 |
|---|---|---|
| `trino.run-query` | Run query | `Ctrl/Cmd+Enter` |
| `trino.explain-query` | Explain Query | 컨텍스트 메뉴 |
| `trino.show-help` | Show Help | `Shift+F1` (+ `Ctrl/Cmd+Click`) |
| `trino.prettify` | Prettify | `Shift+Alt+F` |

### 11.3 생명주기

- `handlers` ref 로 최신 콜백(`onRunQuery`, `formatter`, `metadataProvider`)을 유지한다. completion provider 는 한 번만 등록하고, `stableMetadata` 델리게이터가 항상 최신 `metadataProvider` 를 호출한다 (클러스터 연결 후 교체 가능).
- `locale` / `hover` / `help` 도 ref 로 읽어, provider 를 다시 등록하지 않고 바로 반영한다.
- hover provider 는 **에디터마다** 등록하고 자기 모델에만 응답한다.
- 언마운트 시 워커, completion·hover provider, 마우스·내용 리스너, 등록한 액션을 모두 dispose 한다.

---

## 12. 공개 API (`src/index.ts`)

```ts
export { TrinoEditor, default } from "./TrinoEditor";
export { setupTrino } from "./trino/setup";
export { TRINO_LANGUAGE_ID, trinoLanguage, trinoLanguageConf } from "./trino/language";
export { TRINO_LIGHT_THEME, TRINO_DARK_THEME, trinoLightTheme, trinoDarkTheme } from "./trino/themes";
export { DEFAULT_EDITOR_OPTIONS } from "./trino/options";
export { DEFAULT_LANGUAGE_ELEMENTS, TRINO_KEYWORDS, TRINO_FUNCTIONS, TRINO_OPERATORS,
         TRINO_TYPES, resolveLanguageElements } from "./trino/keywords";
export { createTrinoCompletionProvider, functionDocumentation } from "./trino/completion";
export { formatTrinoSql, splitSegments } from "./trino/format";
export { allDocEntries, docFor, docUrl, functionDoc, renderDoc } from "./trino/docs";
export { createTrinoHoverProvider, helpAt } from "./trino/hover";
export { TRINO_LOCALES, docSummary, localizeDoc, localizeMessage, uiStrings } from "./trino/i18n";
export { TRINO_EDITOR_FONTS, DEFAULT_TRINO_EDITOR_FONT } from "./trino/fonts";
export { createTrinoMetadataProvider } from "./trino/metadata";
export { buildHeaders, statementPages, runStatement } from "./trino/connection";
export { createTrinoQueryRunner, TrinoQueryError } from "./trino/runner";
export { createTrinoGatewayClient, TrinoGatewayError } from "./trino/gateway";
export { basicAuth, createStarburstFetch } from "./trino/auth";
export { createCompletionWorker } from "./worker/client";
export { createContextAwareCompletionProvider } from "./worker/contextProvider";
// + 모든 타입
```

---

## 13. 빌드 / 의존성

- 런타임: `@monaco-editor/react`, `monaco-editor`, `antlr4ng`, `antlr4-c3`, `comlink`. 피어: `react`, `react-dom`.
- 개발: `vite` (+ `vite-plugin-dts`, `@vitejs/plugin-react`), `typescript`, `tsx`, `antlr4ng-cli`. 데모 글꼴: `d2coding`, `@fontsource/*`.
- 라이브러리 빌드: `npm run build` → `dist/trino-monaco.js` (ES 모듈 + d.ts). 워커는 `worker: { format: "es" }` 로 별도 청크. `react`, `monaco-editor` 등은 external.
- 데모: `npm run dev` (`vite --mode demo`). `/trino` → 클러스터(`VITE_TRINO_TARGET`), `/api` → 게이트웨이(`VITE_TRINO_GATEWAY`, 기본 `http://127.0.0.1:8787`).
- 게이트웨이: `servers/server-node/package.json` — `fastify`, `@fastify/cookie`, `undici` · `servers/server-python/pyproject.toml` — `fastapi`, `uvicorn`, `httpx` · `servers/server-java/pom.xml` — Spring Boot 4 `spring-boot-starter-webmvc`.

---

## 14. 테스트 전략

| 스크립트 | 대상 | 예시 |
|---|---|---|
| `test:core` | caret 문맥 (`\|` 캐럿 표기) | `FROM \|` → table, `SELECT \| FROM t` → column/function, `a.\|` → qualifier, `INSERT INTO orders (\|)`, `UPDATE orders SET \|`, `EXPLAIN SELECT * FROM \|` |
| `test:metadata` | 메타데이터 라우팅·캐시·abort (모의 fetch) | `FROM tpch.\|` → 스키마, `a.\|` → 컬럼, `SHOW COLUMNS` 1회만 호출 |
| `test:runner` | 러너 (모의 fetch) | 페이지 누적, `onPage` 스트리밍, `TrinoQueryError`, abort 시 서버 `DELETE` |
| `test:format` | 포매터 | 문자열·주석 보존, `--` 줄바꿈 유지, `LEFT JOIN` 비분리 |
| `test:docs` | 도움말·다국어 | 함수·타입 전수 커버리지, 문맥별 토픽, 텍스트 위치별 도움말, 링크 형식, 세 언어 번역 완전성·코드 구간 보존, 메시지 번역 |
| `test:gateway` | Node 게이트웨이 (가짜 Trino) + 라이브러리 클라이언트 E2E | 로그인·쿠키 인증·rate limit·세션 수 제한, `nextUri` 재작성, 다른 세션 쿼리 차단, 세션 상태 유지, 로그아웃 취소·롤백, `SESSION_LOST`, DDL 차단, 유휴 종료 |
| `pytest` · `mvn test` | Python / Java 게이트웨이 | Node 시나리오를 언어별로 이식 (가짜 Trino: `httpx.MockTransport` / `Upstream` 구현) |
| `test:live` | 실제 클러스터 E2E (opt-in) | `TRINO_URL`, `TRINO_USER`, `TRINO_PASS` |
| `check:doc-links` | 도움말 링크 (네트워크) | 60개 페이지 + 앵커 |

`npm test` = `test:core` + `test:metadata` + `test:runner` + `test:format` + `test:docs`. 게이트웨이 테스트는 `servers/server-node` 의존성 설치가 필요해 별도(`npm run test:gateway`)로 둔다.

---

## 15. 주요 결정 사항 요약 (ADR)

| # | 결정 | 근거 |
|---|---|---|
| 1 | **축약 문법 직접 작성**, `SqlBase.g4` 미사용 | c3 성능, 번들 크기, 선호 규칙 위치 제어 |
| 2 | 파서는 **Web Worker** 에서만 로드 (Comlink) | 메인 스레드 입력 지연 방지, 메인 번들에서 파서 제외 |
| 3 | 연결은 **`TrinoConnectionOptions` + 주입 가능한 `fetch`** | 직접 연결·프록시·게이트웨이·테스트 모의를 같은 코드로 처리 |
| 4 | 에디터는 실행하지 않고 **`onRunQuery` 콜백**만 제공 | 결과 표시·오류 처리·권한은 호스트 앱마다 다름 |
| 5 | `Ctrl/Cmd+Enter` = 선택 영역 또는 **문서 전체** 실행 | Trino 클라이언트 프로토콜은 요청당 한 문장. 문장 분리기는 v1 범위 밖 |
| 6 | 포매터는 **문자열·주석을 절대 바꾸지 않는** 보수적 방식 | 쿼리 의미 보존이 정렬 품질보다 우선 |
| 7 | 도움말은 별도 패널 없이 **Monaco hover 재사용** | 키보드(`Shift+F1`)·마우스(`Ctrl+Click`)·hover 세 경로를 하나의 provider 로 |
| 8 | 도움말 문구는 **직접 작성** + 공식 문서 앵커 링크 | 저작권 문제 없이 오프라인 동작, 자세한 내용은 공식 문서로 |
| 9 | 번역은 **id 키 + 영어 대체**, 워커 메시지는 메인 스레드에서 번역 | 누락 시에도 동작, 워커 프로토콜 불변 |
| 10 | 게이트웨이는 DB 연결이 아니라 **사용자별 세션을 가진 프로토콜 중계** | Trino 는 이미 HTTP. 기존 러너·메타데이터 코드를 그대로 쓰고, 세션 상태와 자격 증명만 서버로 옮김 |
| 11 | 게이트웨이가 세션 동안 **자격 증명을 메모리에 보관** | Trino 는 요청마다 인증. 대안(브라우저 보관)보다 노출 면이 작음. 대신 메모리 전용·로그 금지·로그아웃/유휴 시 폐기 |
| 12 | 게이트웨이 **Node · Python · Java 3종**, 같은 API·보안 모델·환경변수 | 운영 환경 스택에 맞춰 배포. 업스트림 HTTP 를 주입 가능하게 분리해 가짜 Trino 로 같은 시나리오를 테스트 |

### 15.1 게이트웨이 다중 언어 구현

`servers/` 아래 세 구현은 엔드포인트, 요청/응답 JSON, 오류 형식 `{ error: { code, message } }`, 세션 쿠키(`tmsid`, httpOnly·SameSite=Strict·Secure), 환경변수(`TRINO_CLUSTERS`, `GATEWAY_HOST/PORT/PREFIX`, `SECURE_COOKIE`, `ALLOW_DDL`, `IDLE_TIMEOUT_MIN`, `REQUEST_TIMEOUT_SEC`, `MAX_SESSIONS_PER_USER`, `ALLOW_HEADER_AUTH`)가 같다.

| | server-node | server-python | server-java |
|---|---|---|---|
| 스택 | Fastify | FastAPI + uvicorn | Spring Boot 4 (Spring MVC, virtual threads) |
| 업스트림 HTTP | `fetch` (undici), 주입: `UpstreamFetch` | `httpx.AsyncClient`, 주입: `GatewayOptions.upstream` | `java.net.http.HttpClient`, 주입: `Upstream` Bean |
| `insecureTls` | 별칭별 undici `Agent` | 별칭별 `verify=False` 클라이언트 | 별칭별 trust-all `SSLContext` |
| 요청 타임아웃 | `AbortSignal.timeout` | `asyncio.wait_for` + httpx timeout | `HttpRequest.timeout` (요청 전체) |
| 테스트 | 50 검사 | 19 함수 (Node 50 검사 + 추가 케이스) | 50 |

언어별 차이 (클라이언트 영향 없음):

- 프레임워크 기본 오류(알 수 없는 경로, 본문 크기 초과, 잘못된 JSON)를 Python·Java 는 게이트웨이 오류 형식(`404 NOT_FOUND`, `413 BODY_TOO_LARGE`, `400 BAD_REQUEST`)으로 바꾼다.
- Python 은 `POST …/v1/statement` 본문을 콘텐츠 타입과 관계없이 SQL 로 읽는다 (Fastify 는 `application/json` 본문을 먼저 JSON 으로 해석).
- Java 의 `IDLE_TIMEOUT_MIN`·`REQUEST_TIMEOUT_SEC` 는 정수 (Spring `Duration` 으로 변환). 모든 설정은 `gateway.*` Spring 프로퍼티로도 지정 가능.

---

## 16. 오픈 이슈

- **여러 에디터 인스턴스**: `setupTrino()` 의 정적 completion provider 는 모듈 전역 하나라서, 여러 `<TrinoEditor>` 가 서로 다른 `metadataProvider` 나 `locale` 을 쓰면 마지막으로 마운트한 에디터의 것만 남는다. 문맥 자동완성(`contextAware`)과 hover 는 에디터별로 등록되어 영향이 없다. oracle-monaco 의 모델 URI 라우터(`createModelRouter`) 도입을 검토한다.
- 문장 분리기와 "커서 위치 문장 실행" / 스크립트 실행.
- 함수 시그니처 도움말(SignatureHelp)과 테이블·컬럼 hover(메타데이터 기반).
- 서버 측 문법 검증(`EXPLAIN (TYPE VALIDATE)`) 마커.
- 결과 그리드 컴포넌트를 본 패키지에 포함할지 (현재는 호스트 책임).
- 라이선스/NOTICE: Monaco SQL 정의(MIT) 저작권 고지와, 문법 구조 참고 출처(Trino `SqlBase.g4`, Apache-2.0)를 `NOTICE` 에 유지.
