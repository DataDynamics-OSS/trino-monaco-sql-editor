/**
 * Built-in help for Trino functions, keywords / statements and data types
 * (Shift+F1 / Ctrl+Click / hover).
 *
 * The summaries and examples are written for this editor (not copied from the
 * Trino documentation); each entry links to the matching page and anchor of
 * the official documentation (`scripts/check-doc-links.ts` checks them).
 */
import { localizeDoc, uiStrings, type TrinoLocale } from "./i18n";

export type DocKind =
  | "function"
  | "aggregate"
  | "window"
  | "statement"
  | "clause"
  | "operator"
  | "expression"
  | "type";

/** One help topic. */
export interface TrinoDocEntry {
  /** Stable id for translations: `fn:count`, `topic:GROUP_BY`, `type:VARCHAR`. */
  id: string;
  /** Heading, e.g. `count`, `GROUP BY`, `CREATE TABLE`. */
  title: string;
  kind: DocKind;
  /** One or two sentences (markdown). */
  summary: string;
  /** Syntax outline. */
  syntax?: string;
  /** A short runnable example. */
  example?: string;
  /** Documentation page and anchor: `functions/aggregate#count`, `sql/select#with-clause`. */
  page: string;
}

const DOC_BASE = "https://trino.io/docs";

/** Link to a documentation page (`page#anchor`) for `version` (default `current`). */
export function docUrl(page: string, version = "current"): string {
  const [path, anchor] = page.split("#");
  return `${DOC_BASE}/${version}/${path}.html${anchor ? `#${anchor}` : ""}`;
}

// ---------------------------------------------------------------- functions

type Fn = [syntax: string, summary: string, example?: string];

/** Functions per documentation page; the anchor is the function name. */
const FUNCTION_PAGES: Record<string, Record<string, Fn>> = {
  "functions/aggregate": {
    approx_distinct: ["approx_distinct(x, [e]) → bigint", "Approximate number of distinct values, with a standard error of about 2.3% (or `e`).", "SELECT approx_distinct(custkey) FROM orders;"],
    approx_percentile: ["approx_percentile(x, percentage) → same as x", "Approximate value of `x` at the given percentage (0 to 1); an array of percentages returns an array.", "SELECT approx_percentile(totalprice, 0.5) FROM orders;"],
    arbitrary: ["arbitrary(x) → same as x", "An arbitrary non-null value of `x`, if one exists."],
    array_agg: ["array_agg(x [ORDER BY …]) → array", "Collects the input values, including NULLs, into an array.", "SELECT custkey, array_agg(orderkey ORDER BY orderdate) FROM orders GROUP BY custkey;"],
    avg: ["avg(x) → double", "Average (arithmetic mean) of the non-null input values.", "SELECT avg(totalprice) FROM orders;"],
    bool_and: ["bool_and(boolean) → boolean", "TRUE if every input value is TRUE, otherwise FALSE."],
    bool_or: ["bool_or(boolean) → boolean", "TRUE if any input value is TRUE, otherwise FALSE."],
    checksum: ["checksum(x) → varbinary", "Order-insensitive checksum of the input values."],
    corr: ["corr(y, x) → double", "Correlation coefficient of the input values."],
    count: ["count(*) → bigint | count(x) → bigint", "Number of input rows (`count(*)`) or of non-null values of `x`.", "SELECT orderstatus, count(*) FROM orders GROUP BY orderstatus;"],
    count_if: ["count_if(x) → bigint", "Number of TRUE input values.", "SELECT count_if(totalprice > 1000) FROM orders;"],
    covar_pop: ["covar_pop(y, x) → double", "Population covariance of the input values."],
    covar_samp: ["covar_samp(y, x) → double", "Sample covariance of the input values."],
    every: ["every(boolean) → boolean", "Alias for `bool_and`."],
    geometric_mean: ["geometric_mean(x) → double", "Geometric mean of the input values."],
    histogram: ["histogram(x) → map(K, bigint)", "Map from each distinct value to the number of times it occurs."],
    listagg: ["listagg(x, separator) WITHIN GROUP (ORDER BY …) → varchar", "Concatenates the input values with `separator`, in the given order.", "SELECT listagg(name, ', ') WITHIN GROUP (ORDER BY name) FROM nation;"],
    max: ["max(x) → same as x | max(x, n) → array", "Largest input value (or the `n` largest values as an array)."],
    max_by: ["max_by(x, y) → same as x | max_by(x, y, n) → array", "Value of `x` on the row with the largest `y`.", "SELECT max_by(name, totalprice) FROM orders;"],
    min: ["min(x) → same as x | min(x, n) → array", "Smallest input value (or the `n` smallest values as an array)."],
    min_by: ["min_by(x, y) → same as x | min_by(x, y, n) → array", "Value of `x` on the row with the smallest `y`."],
    map_agg: ["map_agg(key, value) → map(K, V)", "Map built from the key / value pairs of the input rows."],
    multimap_agg: ["multimap_agg(key, value) → map(K, array(V))", "Map from each key to the array of all its values."],
    regr_intercept: ["regr_intercept(y, x) → double", "Intercept of the linear regression line of `y` on `x`."],
    regr_slope: ["regr_slope(y, x) → double", "Slope of the linear regression line of `y` on `x`."],
    skewness: ["skewness(x) → double", "Fisher's moment coefficient of skewness of the input values."],
    stddev: ["stddev(x) → double", "Alias for `stddev_samp`."],
    stddev_pop: ["stddev_pop(x) → double", "Population standard deviation of the input values."],
    stddev_samp: ["stddev_samp(x) → double", "Sample standard deviation of the input values."],
    sum: ["sum(x) → same as x", "Sum of the non-null input values.", "SELECT sum(totalprice) FROM orders;"],
    variance: ["variance(x) → double", "Alias for `var_samp`."],
    var_pop: ["var_pop(x) → double", "Population variance of the input values."],
    var_samp: ["var_samp(x) → double", "Sample variance of the input values."],
  },
  "functions/window": {
    cume_dist: ["cume_dist() → double", "Share of rows in the partition that sort at or before the current row."],
    dense_rank: ["dense_rank() → bigint", "Rank of the row without gaps: ties share a rank and the next rank follows directly."],
    first_value: ["first_value(x) → same as x", "Value of `x` on the first row of the window frame."],
    lag: ["lag(x, [offset, [default]]) → same as x", "Value of `x` on the row `offset` rows (default 1) before the current row.", "SELECT orderdate, totalprice - lag(totalprice) OVER (ORDER BY orderdate) FROM orders;"],
    last_value: ["last_value(x) → same as x", "Value of `x` on the last row of the window frame."],
    lead: ["lead(x, [offset, [default]]) → same as x", "Value of `x` on the row `offset` rows (default 1) after the current row."],
    nth_value: ["nth_value(x, offset) → same as x", "Value of `x` on the `offset`-th row of the window frame (1-based)."],
    ntile: ["ntile(n) → bigint", "Splits the partition into `n` buckets and returns the bucket number of the row."],
    percent_rank: ["percent_rank() → double", "Relative rank of the row: `(rank - 1) / (rows - 1)`."],
    rank: ["rank() → bigint", "Rank of the row: ties share a rank and leave gaps after them."],
    row_number: ["row_number() → bigint", "Sequential number of the row in its partition, starting at 1.", "SELECT row_number() OVER (PARTITION BY custkey ORDER BY orderdate) FROM orders;"],
  },
  "functions/array": {
    array_distinct: ["array_distinct(x) → array", "Removes duplicate values from the array."],
    array_intersect: ["array_intersect(x, y) → array", "Elements present in both arrays, without duplicates."],
    array_join: ["array_join(x, delimiter, [null_replacement]) → varchar", "Joins the array elements into a string with `delimiter`.", "SELECT array_join(ARRAY['a', 'b', 'c'], ',');  -- a,b,c"],
    array_max: ["array_max(x) → x", "Largest element of the array."],
    array_min: ["array_min(x) → x", "Smallest element of the array."],
    array_position: ["array_position(x, element) → bigint", "1-based position of the first occurrence of `element` (0 if absent)."],
    array_remove: ["array_remove(x, element) → array", "Removes every element equal to `element`."],
    array_sort: ["array_sort(x, [function(T, T, int)]) → array", "Sorts the array (NULLs last), optionally with a comparator lambda."],
    array_union: ["array_union(x, y) → array", "Elements of either array, without duplicates."],
    cardinality: ["cardinality(x) → bigint", "Number of elements of an array or entries of a map."],
    contains: ["contains(x, element) → boolean", "TRUE if the array contains `element`.", "SELECT contains(ARRAY[1, 2, 3], 2);  -- true"],
    element_at: ["element_at(array(E), index) → E | element_at(map(K, V), key) → V", "Array element at `index` (negative counts from the end) or map value for `key`; NULL when missing.", "SELECT element_at(ARRAY['a', 'b'], -1);  -- b"],
    filter: ["filter(array(T), function(T, boolean)) → array(T)", "Elements for which the lambda returns TRUE.", "SELECT filter(ARRAY[5, -6, 7], x -> x > 0);  -- [5, 7]"],
    flatten: ["flatten(x) → array", "Flattens an array of arrays into one array."],
    reduce: ["reduce(array(T), initialState S, inputFunction(S, T, S), outputFunction(S, R)) → R", "Folds the array into a single value with the input lambda, then applies the output lambda.", "SELECT reduce(ARRAY[1, 2, 3], 0, (s, x) -> s + x, s -> s);  -- 6"],
    sequence: ["sequence(start, stop, [step]) → array", "Array of values from `start` to `stop` (numbers, dates or timestamps).", "SELECT sequence(1, 5);  -- [1, 2, 3, 4, 5]"],
    slice: ["slice(x, start, length) → array", "Sub-array of `length` elements starting at `start` (negative counts from the end)."],
    transform: ["transform(array(T), function(T, U)) → array(U)", "Applies the lambda to every element.", "SELECT transform(ARRAY[1, 2], x -> x * 10);  -- [10, 20]"],
    zip: ["zip(array1, array2, …) → array(row)", "Merges arrays element-wise into an array of rows."],
    zip_with: ["zip_with(array(T), array(U), function(T, U, R)) → array(R)", "Merges two arrays element-wise with a lambda."],
  },
  "functions/map": {
    map: ["map() → map | map(array(K), array(V)) → map(K, V)", "Builds a map from an array of keys and an array of values.", "SELECT map(ARRAY['a', 'b'], ARRAY[1, 2]);"],
    map_concat: ["map_concat(map1, map2, …) → map", "Union of the maps; for duplicate keys the last value wins."],
    map_entries: ["map_entries(x) → array(row(K, V))", "Array of the map's key / value entries."],
    map_filter: ["map_filter(map(K, V), function(K, V, boolean)) → map(K, V)", "Entries for which the lambda returns TRUE."],
    map_keys: ["map_keys(x) → array(K)", "Array of the map's keys."],
    map_values: ["map_values(x) → array(V)", "Array of the map's values."],
  },
  "functions/string": {
    chr: ["chr(n) → varchar", "Character for the Unicode code point `n`."],
    codepoint: ["codepoint(string) → integer", "Unicode code point of a single-character string."],
    concat: ["concat(string1, …, stringN) → varchar", "Concatenates the strings (same as `||`).", "SELECT concat(name, ' (', comment, ')') FROM nation;"],
    concat_ws: ["concat_ws(separator, string1, …, stringN) → varchar", "Concatenates the strings with `separator` between them, skipping NULLs."],
    from_utf8: ["from_utf8(binary, [replace]) → varchar", "Decodes UTF-8 bytes to a string; invalid sequences become `replace` (default U+FFFD)."],
    length: ["length(string) → bigint", "Length of the string in characters.", "SELECT length('Trino');  -- 5"],
    levenshtein_distance: ["levenshtein_distance(string1, string2) → bigint", "Levenshtein edit distance between the two strings."],
    lower: ["lower(string) → varchar", "Converts the string to lowercase."],
    lpad: ["lpad(string, size, padstring) → varchar", "Left-pads the string to `size` characters with `padstring`.", "SELECT lpad('42', 5, '0');  -- 00042"],
    ltrim: ["ltrim(string) → varchar", "Removes leading whitespace."],
    replace: ["replace(string, search, [replace]) → varchar", "Replaces every `search` with `replace` (or removes it).", "SELECT replace('2024-01-31', '-', '');  -- 20240131"],
    reverse: ["reverse(string) → varchar", "The string with its characters in reverse order."],
    rpad: ["rpad(string, size, padstring) → varchar", "Right-pads the string to `size` characters with `padstring`."],
    rtrim: ["rtrim(string) → varchar", "Removes trailing whitespace."],
    split: ["split(string, delimiter, [limit]) → array(varchar)", "Splits the string on `delimiter` into an array.", "SELECT split('a,b,c', ',');  -- [a, b, c]"],
    split_part: ["split_part(string, delimiter, index) → varchar", "Field `index` (1-based) of the string split on `delimiter`.", "SELECT split_part('a,b,c', ',', 2);  -- b"],
    strpos: ["strpos(string, substring, [instance]) → bigint", "1-based position of `substring` in the string (0 if absent)."],
    substr: ["substr(string, start, [length]) → varchar", "Substring from `start` (1-based; negative counts from the end), optionally `length` characters.", "SELECT substr('Trino', 2, 3);  -- rin"],
    substring: ["substring(string, start, [length]) → varchar | substring(string FROM start [FOR length])", "Alias for `substr`; also accepts the SQL `FROM … FOR …` form."],
    to_utf8: ["to_utf8(string) → varbinary", "Encodes the string as UTF-8 bytes."],
    trim: ["trim([[LEADING | TRAILING | BOTH] [chars] FROM] string) → varchar", "Removes leading and/or trailing whitespace (or `chars`).", "SELECT trim(LEADING '0' FROM '00042');  -- 42"],
    upper: ["upper(string) → varchar", "Converts the string to uppercase."],
    word_stem: ["word_stem(word, [lang]) → varchar", "Stem of an English (or `lang`) word."],
  },
  "functions/regexp": {
    regexp_extract: ["regexp_extract(string, pattern, [group]) → varchar", "First substring matching the regular expression (or its capturing `group`).", "SELECT regexp_extract('1a 2b 14m', '\\d+');  -- 1"],
    regexp_extract_all: ["regexp_extract_all(string, pattern, [group]) → array(varchar)", "All substrings matching the regular expression."],
    regexp_like: ["regexp_like(string, pattern) → boolean", "TRUE if the regular expression matches anywhere in the string.", "SELECT * FROM nation WHERE regexp_like(name, '^A');"],
    regexp_replace: ["regexp_replace(string, pattern, [replacement]) → varchar", "Replaces every match of the regular expression (`$1` refers to a group).", "SELECT regexp_replace('010-1234-5678', '[^0-9]', '');"],
    regexp_split: ["regexp_split(string, pattern) → array(varchar)", "Splits the string on a regular expression."],
  },
  "functions/datetime": {
    current_date: ["current_date → date", "The current date at the start of the query."],
    current_time: ["current_time → time with time zone", "The current time at the start of the query."],
    current_timestamp: ["current_timestamp → timestamp(3) with time zone", "The current timestamp at the start of the query."],
    date: ["date(x) → date", "Converts a string or timestamp to a date (same as `CAST(x AS date)`)."],
    date_add: ["date_add(unit, value, timestamp) → same as timestamp", "Adds `value` units (`'day'`, `'month'`, …) to a date / time / timestamp.", "SELECT date_add('day', 7, DATE '2024-01-31');"],
    date_diff: ["date_diff(unit, timestamp1, timestamp2) → bigint", "Number of `unit`s from `timestamp1` to `timestamp2`.", "SELECT date_diff('day', DATE '2024-01-01', DATE '2024-03-01');  -- 60"],
    date_format: ["date_format(timestamp, format) → varchar", "Formats a timestamp with a MySQL format string (`%Y-%m-%d`).", "SELECT date_format(now(), '%Y-%m-%d %H:%i');"],
    date_parse: ["date_parse(string, format) → timestamp(3)", "Parses a string with a MySQL format string."],
    date_trunc: ["date_trunc(unit, x) → same as x", "Truncates a date / time / timestamp to `unit` (`'month'`, `'hour'`, …).", "SELECT date_trunc('month', orderdate), count(*) FROM orders GROUP BY 1;"],
    day: ["day(x) → bigint", "Day of the month (1-31)."],
    day_of_month: ["day_of_month(x) → bigint", "Alias for `day`."],
    day_of_week: ["day_of_week(x) → bigint", "ISO day of the week, 1 (Monday) to 7 (Sunday)."],
    day_of_year: ["day_of_year(x) → bigint", "Day of the year, 1 to 366."],
    format_datetime: ["format_datetime(timestamp, format) → varchar", "Formats a timestamp with a Java (Joda-Time) pattern (`yyyy-MM-dd`)."],
    from_iso8601_date: ["from_iso8601_date(string) → date", "Parses an ISO 8601 date string."],
    from_iso8601_timestamp: ["from_iso8601_timestamp(string) → timestamp(3) with time zone", "Parses an ISO 8601 timestamp string."],
    from_unixtime: ["from_unixtime(unixtime, [zone]) → timestamp(3) with time zone", "Converts seconds since the Unix epoch to a timestamp.", "SELECT from_unixtime(1700000000);"],
    hour: ["hour(x) → bigint", "Hour of the day (0-23)."],
    minute: ["minute(x) → bigint", "Minute of the hour (0-59)."],
    month: ["month(x) → bigint", "Month of the year (1-12)."],
    now: ["now() → timestamp(3) with time zone", "Alias for `current_timestamp`."],
    parse_datetime: ["parse_datetime(string, format) → timestamp with time zone", "Parses a string with a Java (Joda-Time) pattern."],
    quarter: ["quarter(x) → bigint", "Quarter of the year (1-4)."],
    second: ["second(x) → bigint", "Second of the minute (0-59)."],
    to_iso8601: ["to_iso8601(x) → varchar", "Formats a date / timestamp as an ISO 8601 string."],
    to_unixtime: ["to_unixtime(timestamp) → double", "Seconds since the Unix epoch."],
    week: ["week(x) → bigint", "ISO week of the year (1-53)."],
    year: ["year(x) → bigint", "Year of a date / timestamp.", "SELECT year(orderdate), count(*) FROM orders GROUP BY 1;"],
  },
  "functions/math": {
    abs: ["abs(x) → same as x", "Absolute value."],
    acos: ["acos(x) → double", "Arc cosine (radians)."],
    asin: ["asin(x) → double", "Arc sine (radians)."],
    atan: ["atan(x) → double", "Arc tangent (radians)."],
    atan2: ["atan2(y, x) → double", "Arc tangent of `y / x` (radians), using the signs to pick the quadrant."],
    cbrt: ["cbrt(x) → double", "Cube root."],
    ceil: ["ceil(x) → same as x", "Alias for `ceiling`."],
    ceiling: ["ceiling(x) → same as x", "Rounds up to the nearest integer.", "SELECT ceiling(4.1);  -- 5"],
    cos: ["cos(x) → double", "Cosine of `x` (radians)."],
    cosh: ["cosh(x) → double", "Hyperbolic cosine."],
    degrees: ["degrees(x) → double", "Converts radians to degrees."],
    e: ["e() → double", "Euler's number."],
    exp: ["exp(x) → double", "Euler's number raised to the power `x`."],
    floor: ["floor(x) → same as x", "Rounds down to the nearest integer.", "SELECT floor(4.9);  -- 4"],
    from_base: ["from_base(string, radix) → bigint", "Parses a number written in base `radix`.", "SELECT from_base('ff', 16);  -- 255"],
    ln: ["ln(x) → double", "Natural logarithm."],
    log: ["log(b, x) → double", "Logarithm of `x` in base `b`."],
    log2: ["log2(x) → double", "Base-2 logarithm."],
    log10: ["log10(x) → double", "Base-10 logarithm."],
    mod: ["mod(n, m) → same as n", "Remainder of `n` divided by `m`.", "SELECT mod(17, 5);  -- 2"],
    pi: ["pi() → double", "The constant π."],
    pow: ["pow(x, p) → double", "Alias for `power`."],
    power: ["power(x, p) → double", "`x` raised to the power `p`.", "SELECT power(2, 10);  -- 1024"],
    radians: ["radians(x) → double", "Converts degrees to radians."],
    rand: ["rand() → double", "Alias for `random`."],
    random: ["random() → double | random(n) → same as n | random(m, n) → same as n", "Pseudo-random number in [0, 1), in [0, n) or in [m, n)."],
    round: ["round(x, [d]) → same as x", "Rounds to `d` decimal places (default 0), half away from zero.", "SELECT round(123.456, 1);  -- 123.5"],
    sign: ["sign(x) → same as x", "Sign of `x`: -1, 0 or 1."],
    sin: ["sin(x) → double", "Sine of `x` (radians)."],
    sqrt: ["sqrt(x) → double", "Square root."],
    tan: ["tan(x) → double", "Tangent of `x` (radians)."],
    tanh: ["tanh(x) → double", "Hyperbolic tangent."],
    to_base: ["to_base(x, radix) → varchar", "Writes `x` in base `radix`.", "SELECT to_base(255, 16);  -- ff"],
    truncate: ["truncate(x) → double", "Drops the fractional part (rounds toward zero)."],
    width_bucket: ["width_bucket(x, bound1, bound2, n) → bigint", "Bucket number of `x` in `n` equal-width buckets between `bound1` and `bound2`."],
  },
  "functions/comparison": {
    greatest: ["greatest(value1, value2, …, valueN) → same as input", "Largest of the arguments (NULL if any argument is NULL).", "SELECT greatest(1, 5, 3);  -- 5"],
    least: ["least(value1, value2, …, valueN) → same as input", "Smallest of the arguments (NULL if any argument is NULL)."],
  },
  "functions/json": {
    json_array_contains: ["json_array_contains(json, value) → boolean", "TRUE if the JSON array contains `value`."],
    json_array_get: ["json_array_get(json_array, index) → json", "Element at `index` (0-based; negative counts from the end) of a JSON array."],
    json_array_length: ["json_array_length(json) → bigint", "Length of a JSON array."],
    json_extract: ["json_extract(json, json_path) → json", "Value at a JSONPath (`$.a.b`) as JSON.", "SELECT json_extract(payload, '$.items[0]') FROM events;"],
    json_extract_scalar: ["json_extract_scalar(json, json_path) → varchar", "Scalar value at a JSONPath as a string.", "SELECT json_extract_scalar('{\"a\": 1}', '$.a');  -- 1"],
    json_format: ["json_format(json) → varchar", "Serializes a JSON value to text."],
    json_parse: ["json_parse(string) → json", "Parses text into a JSON value."],
    json_size: ["json_size(json, json_path) → bigint", "Size of the array or object at a JSONPath (0 for scalars)."],
  },
  "functions/conditional": {
    coalesce: ["coalesce(value1, value2, …) → same as input", "First non-null argument.", "SELECT coalesce(comment, 'n/a') FROM orders;"],
    if: ["if(condition, true_value, [false_value]) → same as true_value", "`true_value` if the condition is TRUE, otherwise `false_value` (or NULL).", "SELECT if(totalprice > 1000, 'big', 'small') FROM orders;"],
    nullif: ["nullif(value1, value2) → same as value1", "NULL if the two values are equal, otherwise `value1`."],
    try: ["try(expression) → same as expression", "Evaluates the expression and returns NULL instead of failing on errors such as division by zero or invalid casts.", "SELECT try(total / count) FROM stats;"],
  },
  "functions/conversion": {
    cast: ["CAST(value AS type) → type", "Converts the value to `type`; fails if it cannot be converted.", "SELECT CAST('2024-01-31' AS date);"],
    format: ["format(format, args…) → varchar", "Formats the arguments with a Java format string (`%s`, `%d`, `%.2f`).", "SELECT format('%s has %d rows', 'orders', 15000);"],
    try_cast: ["TRY_CAST(value AS type) → type", "Like `CAST`, but returns NULL when the value cannot be converted.", "SELECT TRY_CAST('abc' AS integer);  -- NULL"],
    typeof: ["typeof(expr) → varchar", "Name of the expression's data type.", "SELECT typeof(1.5);  -- decimal(2,1)"],
  },
};

const FUNCTION_KIND: Record<string, DocKind> = {
  "functions/aggregate": "aggregate",
  "functions/window": "window",
};

const FUNCTIONS = new Map<string, TrinoDocEntry>();
for (const [page, fns] of Object.entries(FUNCTION_PAGES)) {
  for (const [name, [syntax, summary, example]] of Object.entries(fns)) {
    FUNCTIONS.set(name, {
      id: `fn:${name}`,
      title: name,
      kind: FUNCTION_KIND[page] ?? "function",
      summary,
      syntax,
      ...(example ? { example } : {}),
      page: `${page}#${name}`,
    });
  }
}

// ---------------------------------------------------------------- keywords

type Topic = Omit<TrinoDocEntry, "id">;

/** Keyword / clause / statement topics. Keys are topic ids. */
const TOPICS: Record<string, Topic> = {
  // queries
  SELECT: { title: "SELECT", kind: "statement", page: "sql/select", summary: "Retrieves rows from tables, views, subqueries and table functions.", syntax: "[WITH …] SELECT [ALL | DISTINCT] select_expr, … [FROM from_item, …] [WHERE condition] [GROUP BY …] [HAVING condition] [WINDOW …] [{UNION | INTERSECT | EXCEPT} …] [ORDER BY …] [OFFSET n] [LIMIT n | FETCH FIRST n ROWS {ONLY | WITH TIES}]", example: "SELECT orderstatus, count(*) FROM orders WHERE totalprice > 1000 GROUP BY orderstatus ORDER BY 2 DESC;" },
  DISTINCT: { title: "SELECT DISTINCT", kind: "clause", page: "sql/select#select-clause", summary: "Removes duplicate rows from the result (`ALL`, the default, keeps them).", syntax: "SELECT [ALL | DISTINCT] select_expr, …" },
  WITH: { title: "WITH", kind: "clause", page: "sql/select#with-clause", summary: "Names subqueries (common table expressions) that the main query can reference.", syntax: "WITH name [(column, …)] AS (query) [, …] SELECT …", example: "WITH big AS (SELECT * FROM orders WHERE totalprice > 1000)\nSELECT custkey, count(*) FROM big GROUP BY custkey;" },
  WITH_RECURSIVE: { title: "WITH RECURSIVE", kind: "clause", page: "sql/select#with-recursive-clause", summary: "A common table expression that references itself: a base query `UNION ALL` a recursive step.", syntax: "WITH RECURSIVE name (column, …) AS (base_query UNION ALL recursive_query) SELECT …", example: "WITH RECURSIVE t(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM t WHERE n < 5)\nSELECT sum(n) FROM t;" },
  FROM: { title: "FROM", kind: "clause", page: "sql/select", summary: "The tables, views, subqueries, `UNNEST` or table functions a query reads; several items are joined.", syntax: "FROM from_item [, …]" },
  WHERE: { title: "WHERE", kind: "clause", page: "sql/select", summary: "Keeps only the rows for which the condition is TRUE (not FALSE or NULL)." },
  GROUP_BY: { title: "GROUP BY", kind: "clause", page: "sql/select#group-by-clause", summary: "Groups rows for aggregate functions; expressions may be given by position (`GROUP BY 1`).", syntax: "GROUP BY [ALL | DISTINCT] {expression | GROUPING SETS (…) | CUBE (…) | ROLLUP (…)} [, …]" },
  GROUPING_SETS: { title: "GROUPING SETS", kind: "clause", page: "sql/select#grouping-sets", summary: "Aggregates over several groupings in one query; columns not in a set are NULL in its rows.", syntax: "GROUP BY GROUPING SETS ((a, b), (a), ())" },
  CUBE: { title: "CUBE", kind: "clause", page: "sql/select#cube", summary: "Groups by every combination of the listed columns.", syntax: "GROUP BY CUBE (a, b)" },
  ROLLUP: { title: "ROLLUP", kind: "clause", page: "sql/select#rollup", summary: "Groups by each prefix of the listed columns, adding subtotals and a grand total.", syntax: "GROUP BY ROLLUP (a, b)" },
  HAVING: { title: "HAVING", kind: "clause", page: "sql/select#having-clause", summary: "Filters groups after GROUP BY; may use aggregates.", example: "SELECT custkey FROM orders GROUP BY custkey HAVING count(*) > 10;" },
  WINDOW: { title: "WINDOW", kind: "clause", page: "sql/select#window-clause", summary: "Defines named window specifications that `OVER` clauses can refer to.", syntax: "WINDOW name AS (window_specification) [, …]" },
  UNION: { title: "UNION", kind: "operator", page: "sql/select#union-clause", summary: "Combines the rows of two queries; `UNION` removes duplicates, `UNION ALL` keeps them.", syntax: "query UNION [ALL | DISTINCT] query" },
  INTERSECT: { title: "INTERSECT", kind: "operator", page: "sql/select#intersect-clause", summary: "Rows returned by both queries.", syntax: "query INTERSECT [ALL | DISTINCT] query" },
  EXCEPT: { title: "EXCEPT", kind: "operator", page: "sql/select#except-clause", summary: "Rows of the first query that the second query does not return.", syntax: "query EXCEPT [ALL | DISTINCT] query" },
  ORDER_BY: { title: "ORDER BY", kind: "clause", page: "sql/select#order-by-clause", summary: "Sorts the result; NULLs sort last by default.", syntax: "ORDER BY expression [ASC | DESC] [NULLS {FIRST | LAST}] [, …]" },
  OFFSET: { title: "OFFSET", kind: "clause", page: "sql/select#offset-clause", summary: "Skips the first `n` rows of the result.", syntax: "OFFSET n [ROW | ROWS]" },
  LIMIT: { title: "LIMIT / FETCH FIRST", kind: "clause", page: "sql/select#limit-or-fetch-first-clause", summary: "Limits the number of rows returned; `WITH TIES` also returns rows tied with the last one.", syntax: "LIMIT {n | ALL}\nFETCH {FIRST | NEXT} [n] {ROW | ROWS} {ONLY | WITH TIES}", example: "SELECT * FROM orders ORDER BY totalprice DESC LIMIT 10;" },
  TABLESAMPLE: { title: "TABLESAMPLE", kind: "clause", page: "sql/select#tablesample", summary: "Reads a random sample of a table: `BERNOULLI` samples rows, `SYSTEM` samples splits.", syntax: "FROM table TABLESAMPLE {BERNOULLI | SYSTEM} (percentage)" },
  UNNEST: { title: "UNNEST", kind: "clause", page: "sql/select#unnest", summary: "Expands arrays and maps into rows; `WITH ORDINALITY` adds a position column.", syntax: "CROSS JOIN UNNEST(array_expr [, …]) [WITH ORDINALITY] AS t (column, …)", example: "SELECT o.orderkey, item FROM orders o CROSS JOIN UNNEST(o.items) AS t (item);" },
  JSON_TABLE: { title: "JSON_TABLE", kind: "clause", page: "sql/select#json-table", summary: "Turns JSON data into a relational table with typed columns, using JSON path expressions.", syntax: "JSON_TABLE(json_input, json_path COLUMNS (name type PATH path, …))" },
  JOIN: { title: "JOIN", kind: "clause", page: "sql/select#joins", summary: "Combines rows of two relations: `[INNER] JOIN`, `LEFT` / `RIGHT` / `FULL [OUTER] JOIN` with `ON` or `USING`, or `CROSS JOIN`.", syntax: "from_item [INNER | LEFT [OUTER] | RIGHT [OUTER] | FULL [OUTER]] JOIN from_item {ON condition | USING (column, …)}", example: "SELECT c.name, o.totalprice FROM customer c LEFT JOIN orders o ON o.custkey = c.custkey;" },
  CROSS_JOIN: { title: "CROSS JOIN", kind: "clause", page: "sql/select#cross-join", summary: "Cartesian product: every row of the left side with every row of the right side.", syntax: "from_item CROSS JOIN from_item" },
  LATERAL: { title: "LATERAL", kind: "clause", page: "sql/select#lateral", summary: "A subquery in FROM that can reference columns of the relations before it.", syntax: "FROM t, LATERAL (SELECT … WHERE … = t.column)" },
  VALUES: { title: "VALUES", kind: "statement", page: "sql/values", summary: "A literal inline table; usable as a query or in FROM.", syntax: "VALUES row [, …]", example: "SELECT * FROM (VALUES (1, 'a'), (2, 'b')) AS t (id, name);" },
  // expressions and predicates
  CASE: { title: "CASE", kind: "expression", page: "functions/conditional#case", summary: "Returns the result of the first matching `WHEN` branch, else the `ELSE` value (or NULL).", syntax: "CASE expression WHEN value THEN result [ …] [ELSE result] END\nCASE WHEN condition THEN result [ …] [ELSE result] END", example: "SELECT CASE WHEN totalprice > 1000 THEN 'big' ELSE 'small' END FROM orders;" },
  EXISTS: { title: "EXISTS", kind: "operator", page: "sql/select#exists", summary: "TRUE if the subquery returns at least one row.", syntax: "EXISTS (subquery)" },
  IN: { title: "IN", kind: "operator", page: "functions/comparison#in-operator", summary: "TRUE if the value equals any value in the list or subquery.", syntax: "expression [NOT] IN (value, … | subquery)" },
  BETWEEN: { title: "BETWEEN", kind: "operator", page: "functions/comparison#range-operator-between", summary: "TRUE if the value is within the range, bounds included.", syntax: "expression [NOT] BETWEEN [ASYMMETRIC | SYMMETRIC] min AND max" },
  LIKE: { title: "LIKE", kind: "operator", page: "functions/comparison#like-operator", summary: "Pattern match: `%` matches any characters, `_` exactly one.", syntax: "expression [NOT] LIKE pattern [ESCAPE escape_char]", example: "SELECT * FROM nation WHERE name LIKE 'A%';" },
  IS_NULL: { title: "IS [NOT] NULL", kind: "operator", page: "functions/comparison#is-null-operator", summary: "Tests for NULL; `= NULL` is never TRUE.", syntax: "expression IS [NOT] NULL" },
  IS_DISTINCT: { title: "IS [NOT] DISTINCT FROM", kind: "operator", page: "functions/comparison#is-distinct-operator", summary: "Null-safe comparison: two NULLs are not distinct.", syntax: "a IS [NOT] DISTINCT FROM b" },
  LOGICAL: { title: "AND / OR / NOT", kind: "operator", page: "functions/logical", summary: "Logical operators with three-valued logic (TRUE, FALSE, NULL)." },
  OVER: { title: "OVER (window functions)", kind: "clause", page: "functions/window", summary: "Turns a ranking, value or aggregate function into a window function computed over related rows.", syntax: "function(args) OVER ([PARTITION BY …] [ORDER BY …] [{ROWS | RANGE | GROUPS} frame])", example: "SELECT custkey, totalprice, rank() OVER (PARTITION BY custkey ORDER BY totalprice DESC) FROM orders;" },
  FILTER: { title: "FILTER (aggregation)", kind: "clause", page: "functions/aggregate#filtering-during-aggregation", summary: "Restricts the rows an aggregate function sees.", syntax: "aggregate(args) FILTER (WHERE condition)", example: "SELECT count(*) FILTER (WHERE orderstatus = 'F') FROM orders;" },
  AT_TIME_ZONE: { title: "AT TIME ZONE", kind: "operator", page: "functions/datetime#at-time-zone-operator", summary: "Converts a timestamp with time zone to another time zone.", syntax: "timestamp AT TIME ZONE zone", example: "SELECT now() AT TIME ZONE 'Asia/Seoul';" },
  EXTRACT: { title: "EXTRACT", kind: "function", page: "functions/datetime#extract", summary: "A field (YEAR, MONTH, DAY, HOUR, …) of a date, time, timestamp or interval.", syntax: "EXTRACT(field FROM x) → bigint", example: "SELECT EXTRACT(YEAR FROM orderdate) FROM orders;" },
  // DML
  INSERT: { title: "INSERT", kind: "statement", page: "sql/insert", summary: "Inserts rows from `VALUES` or a query.", syntax: "INSERT INTO table [(column, …)] {VALUES … | query}", example: "INSERT INTO nation_copy SELECT * FROM nation;" },
  UPDATE: { title: "UPDATE", kind: "statement", page: "sql/update", summary: "Changes column values of the rows that match the condition (the connector must support it).", syntax: "UPDATE table SET column = expression [, …] [WHERE condition]" },
  DELETE: { title: "DELETE", kind: "statement", page: "sql/delete", summary: "Deletes the rows that match the condition (the connector must support it).", syntax: "DELETE FROM table [WHERE condition]" },
  MERGE: { title: "MERGE", kind: "statement", page: "sql/merge", summary: "Inserts, updates or deletes target rows depending on whether they match a source.", syntax: "MERGE INTO target [AS alias] USING source ON condition\nWHEN MATCHED [AND …] THEN {UPDATE SET … | DELETE}\nWHEN NOT MATCHED [AND …] THEN INSERT [(column, …)] VALUES (…)" },
  TRUNCATE: { title: "TRUNCATE", kind: "statement", page: "sql/truncate", summary: "Deletes all rows of a table.", syntax: "TRUNCATE TABLE table" },
  // DDL
  CREATE_TABLE: { title: "CREATE TABLE", kind: "statement", page: "sql/create-table", summary: "Creates an empty table; connector-specific options go in `WITH (…)`.", syntax: "CREATE [OR REPLACE] TABLE [IF NOT EXISTS] name (column type [NOT NULL] [COMMENT …] [WITH (…)], … | LIKE other [{INCLUDING | EXCLUDING} PROPERTIES]) [COMMENT …] [WITH (property = value, …)]", example: "CREATE TABLE IF NOT EXISTS orders_2024 (orderkey bigint, orderdate date) WITH (format = 'PARQUET');" },
  CREATE_TABLE_AS: { title: "CREATE TABLE AS", kind: "statement", page: "sql/create-table-as", summary: "Creates a table filled with the result of a query.", syntax: "CREATE [OR REPLACE] TABLE [IF NOT EXISTS] name [(column, …)] [COMMENT …] [WITH (…)] AS query [WITH [NO] DATA]", example: "CREATE TABLE big_orders AS SELECT * FROM orders WHERE totalprice > 1000;" },
  CREATE_VIEW: { title: "CREATE VIEW", kind: "statement", page: "sql/create-view", summary: "Creates a view: a saved query that is run when the view is queried.", syntax: "CREATE [OR REPLACE] VIEW name [COMMENT …] [SECURITY {DEFINER | INVOKER}] AS query" },
  CREATE_MATERIALIZED_VIEW: { title: "CREATE MATERIALIZED VIEW", kind: "statement", page: "sql/create-materialized-view", summary: "Creates a view whose result is stored and updated by `REFRESH MATERIALIZED VIEW`.", syntax: "CREATE [OR REPLACE] MATERIALIZED VIEW [IF NOT EXISTS] name [GRACE PERIOD interval] [COMMENT …] [WITH (…)] AS query" },
  CREATE_SCHEMA: { title: "CREATE SCHEMA", kind: "statement", page: "sql/create-schema", summary: "Creates a schema in a catalog.", syntax: "CREATE SCHEMA [IF NOT EXISTS] [catalog.]schema [AUTHORIZATION …] [WITH (…)]" },
  ALTER_TABLE: { title: "ALTER TABLE", kind: "statement", page: "sql/alter-table", summary: "Renames a table, or adds, drops, renames or changes the type of columns, or sets table properties.", syntax: "ALTER TABLE [IF EXISTS] name {RENAME TO … | ADD COLUMN … | DROP COLUMN … | RENAME COLUMN … TO … | ALTER COLUMN … SET DATA TYPE … | SET PROPERTIES … | EXECUTE …}" },
  ALTER_VIEW: { title: "ALTER VIEW", kind: "statement", page: "sql/alter-view", summary: "Renames a view or changes its owner.", syntax: "ALTER VIEW name {RENAME TO new_name | SET AUTHORIZATION user}" },
  ALTER_SCHEMA: { title: "ALTER SCHEMA", kind: "statement", page: "sql/alter-schema", summary: "Renames a schema or changes its owner.", syntax: "ALTER SCHEMA name {RENAME TO new_name | SET AUTHORIZATION user}" },
  DROP_TABLE: { title: "DROP TABLE", kind: "statement", page: "sql/drop-table", summary: "Drops a table and its data.", syntax: "DROP TABLE [IF EXISTS] name" },
  DROP_VIEW: { title: "DROP VIEW", kind: "statement", page: "sql/drop-view", summary: "Drops a view.", syntax: "DROP VIEW [IF EXISTS] name" },
  DROP_MATERIALIZED_VIEW: { title: "DROP MATERIALIZED VIEW", kind: "statement", page: "sql/drop-materialized-view", summary: "Drops a materialized view and its stored data.", syntax: "DROP MATERIALIZED VIEW [IF EXISTS] name" },
  DROP_SCHEMA: { title: "DROP SCHEMA", kind: "statement", page: "sql/drop-schema", summary: "Drops a schema; it must be empty unless `CASCADE` is given.", syntax: "DROP SCHEMA [IF EXISTS] name [CASCADE | RESTRICT]" },
  REFRESH: { title: "REFRESH MATERIALIZED VIEW", kind: "statement", page: "sql/refresh-materialized-view", summary: "Re-runs the query of a materialized view and stores the new result.", syntax: "REFRESH MATERIALIZED VIEW name" },
  COMMENT: { title: "COMMENT", kind: "statement", page: "sql/comment", summary: "Sets or removes the comment of a table, view or column.", syntax: "COMMENT ON {TABLE | VIEW | COLUMN} name IS {'text' | NULL}" },
  // metadata and session
  SHOW_CATALOGS: { title: "SHOW CATALOGS", kind: "statement", page: "sql/show-catalogs", summary: "Lists the available catalogs.", syntax: "SHOW CATALOGS [LIKE pattern]" },
  SHOW_SCHEMAS: { title: "SHOW SCHEMAS", kind: "statement", page: "sql/show-schemas", summary: "Lists the schemas of a catalog.", syntax: "SHOW SCHEMAS [FROM catalog] [LIKE pattern]" },
  SHOW_TABLES: { title: "SHOW TABLES", kind: "statement", page: "sql/show-tables", summary: "Lists the tables and views of a schema.", syntax: "SHOW TABLES [FROM schema] [LIKE pattern]" },
  SHOW_COLUMNS: { title: "SHOW COLUMNS", kind: "statement", page: "sql/show-columns", summary: "Lists the columns of a table with their types.", syntax: "SHOW COLUMNS FROM table [LIKE pattern]" },
  SHOW_CREATE: { title: "SHOW CREATE", kind: "statement", page: "sql/show-create-table", summary: "Shows the SQL statement that creates a table, view, materialized view, schema or function.", syntax: "SHOW CREATE {TABLE | VIEW | MATERIALIZED VIEW | SCHEMA} name" },
  SHOW_FUNCTIONS: { title: "SHOW FUNCTIONS", kind: "statement", page: "sql/show-functions", summary: "Lists the available functions with their signatures.", syntax: "SHOW FUNCTIONS [FROM schema] [LIKE pattern]" },
  SHOW_SESSION: { title: "SHOW SESSION", kind: "statement", page: "sql/show-session", summary: "Lists the session properties and their current values.", syntax: "SHOW SESSION [LIKE pattern]" },
  SHOW_STATS: { title: "SHOW STATS", kind: "statement", page: "sql/show-stats", summary: "Shows table or query statistics used by the cost-based optimizer.", syntax: "SHOW STATS FOR {table | (query)}" },
  DESCRIBE: { title: "DESCRIBE", kind: "statement", page: "sql/describe", summary: "Lists the columns of a table (same as `SHOW COLUMNS`).", syntax: "DESCRIBE table" },
  EXPLAIN: { title: "EXPLAIN", kind: "statement", page: "sql/explain", summary: "Shows the logical or distributed execution plan of a statement, or validates it.", syntax: "EXPLAIN [(FORMAT {TEXT | GRAPHVIZ | JSON}, TYPE {LOGICAL | DISTRIBUTED | VALIDATE | IO})] statement" },
  EXPLAIN_ANALYZE: { title: "EXPLAIN ANALYZE", kind: "statement", page: "sql/explain-analyze", summary: "Runs the statement and shows the distributed plan with the actual cost of each operation.", syntax: "EXPLAIN ANALYZE [VERBOSE] statement" },
  ANALYZE: { title: "ANALYZE", kind: "statement", page: "sql/analyze", summary: "Collects table and column statistics for the optimizer.", syntax: "ANALYZE table [WITH (property = value, …)]" },
  USE: { title: "USE", kind: "statement", page: "sql/use", summary: "Sets the session's default catalog and schema.", syntax: "USE [catalog.]schema", example: "USE tpch.sf1;" },
  SET_SESSION: { title: "SET SESSION", kind: "statement", page: "sql/set-session", summary: "Sets a session property for the current session.", syntax: "SET SESSION [catalog.]name = expression", example: "SET SESSION query_max_run_time = '10m';" },
  RESET_SESSION: { title: "RESET SESSION", kind: "statement", page: "sql/reset-session", summary: "Resets a session property to its default value.", syntax: "RESET SESSION [catalog.]name" },
  GRANT: { title: "GRANT", kind: "statement", page: "sql/grant", summary: "Grants privileges on a schema or table to a user or role.", syntax: "GRANT {privilege [, …] | ALL PRIVILEGES} ON [SCHEMA | TABLE] name TO {user | ROLE role} [WITH GRANT OPTION]" },
  REVOKE: { title: "REVOKE", kind: "statement", page: "sql/revoke", summary: "Revokes privileges on a schema or table.", syntax: "REVOKE [GRANT OPTION FOR] {privilege [, …] | ALL PRIVILEGES} ON [SCHEMA | TABLE] name FROM {user | ROLE role}" },
  PREPARE: { title: "PREPARE", kind: "statement", page: "sql/prepare", summary: "Prepares a statement with `?` parameters for later `EXECUTE`.", syntax: "PREPARE name FROM statement" },
  EXECUTE: { title: "EXECUTE", kind: "statement", page: "sql/execute", summary: "Runs a prepared statement with the given parameter values.", syntax: "EXECUTE name [USING value [, …]]" },
  DEALLOCATE: { title: "DEALLOCATE PREPARE", kind: "statement", page: "sql/deallocate-prepare", summary: "Removes a prepared statement from the session.", syntax: "DEALLOCATE PREPARE name" },
  CALL: { title: "CALL", kind: "statement", page: "sql/call", summary: "Calls a procedure provided by a connector.", syntax: "CALL procedure(argument [, …])" },
  START_TRANSACTION: { title: "START TRANSACTION", kind: "statement", page: "sql/start-transaction", summary: "Starts a transaction (only some connectors support multi-statement transactions).", syntax: "START TRANSACTION [ISOLATION LEVEL … | READ {ONLY | WRITE}]" },
  COMMIT: { title: "COMMIT", kind: "statement", page: "sql/commit", summary: "Commits the current transaction.", syntax: "COMMIT [WORK]" },
  ROLLBACK: { title: "ROLLBACK", kind: "statement", page: "sql/rollback", summary: "Rolls back the current transaction.", syntax: "ROLLBACK [WORK]" },
  MATCH_RECOGNIZE: { title: "MATCH_RECOGNIZE", kind: "clause", page: "sql/match-recognize", summary: "Finds patterns of rows (like regular expressions over rows) within ordered partitions.", syntax: "MATCH_RECOGNIZE (PARTITION BY … ORDER BY … MEASURES … PATTERN (…) DEFINE …)" },
};

const TOPIC_ENTRIES: Record<string, TrinoDocEntry> = Object.fromEntries(
  Object.entries(TOPICS).map(([key, t]) => [key, { id: `topic:${key}`, ...t }]),
);

/** Words → topic for the words that name a topic on their own. */
const SIMPLE_TOPICS: Record<string, string> = {
  SELECT: "SELECT", DISTINCT: "DISTINCT", FROM: "FROM", WHERE: "WHERE", HAVING: "HAVING",
  WINDOW: "WINDOW", UNION: "UNION", INTERSECT: "INTERSECT", EXCEPT: "EXCEPT", OFFSET: "OFFSET",
  LIMIT: "LIMIT", TABLESAMPLE: "TABLESAMPLE", UNNEST: "UNNEST", JSON_TABLE: "JSON_TABLE",
  JOIN: "JOIN", INNER: "JOIN", LEFT: "JOIN", RIGHT: "JOIN", FULL: "JOIN", OUTER: "JOIN", ON: "JOIN",
  USING: "JOIN", LATERAL: "LATERAL", VALUES: "VALUES", CASE: "CASE", WHEN: "CASE", THEN: "CASE",
  ELSE: "CASE", END: "CASE", EXISTS: "EXISTS", IN: "IN", BETWEEN: "BETWEEN", LIKE: "LIKE", ESCAPE: "LIKE",
  AND: "LOGICAL", OR: "LOGICAL", NOT: "LOGICAL", OVER: "OVER", PARTITION: "OVER",
  GROUPING: "GROUPING_SETS", CUBE: "CUBE", ROLLUP: "ROLLUP", EXTRACT: "EXTRACT",
  INSERT: "INSERT", UPDATE: "UPDATE", DELETE: "DELETE", MERGE: "MERGE", TRUNCATE: "TRUNCATE",
  REFRESH: "REFRESH", COMMENT: "COMMENT", DESCRIBE: "DESCRIBE", ANALYZE: "ANALYZE", USE: "USE",
  GRANT: "GRANT", REVOKE: "REVOKE", PREPARE: "PREPARE", EXECUTE: "EXECUTE", DEALLOCATE: "DEALLOCATE",
  CALL: "CALL", COMMIT: "COMMIT", ROLLBACK: "ROLLBACK", MATCH_RECOGNIZE: "MATCH_RECOGNIZE",
};

/** Word → topic, given the following words (upper-case; `(` and `;` included). */
function keywordTopic(word: string, next: string[]): string | undefined {
  const [n1, n2] = next;
  const object = (): { obj: string; rest: string[] } => {
    let i = 0;
    if (next[i] === "OR" && next[i + 1] === "REPLACE") i += 2;
    if (next[i] === "MATERIALIZED" && next[i + 1] === "VIEW") return { obj: "MATERIALIZED VIEW", rest: next.slice(i + 2) };
    return { obj: next[i] ?? "", rest: next.slice(i + 1) };
  };
  switch (word) {
    case "WITH":
      if (n1 === "RECURSIVE") return "WITH_RECURSIVE";
      // TIMESTAMP WITH TIME ZONE, WITH (props), WITH ORDINALITY / TIES / GRANT OPTION … are not CTEs.
      return n1 && /^[A-Z_][A-Z0-9_]*$/.test(n1) && !["TIME", "ORDINALITY", "TIES", "GRANT", "NO", "DATA"].includes(n1) ? "WITH" : undefined;
    case "RECURSIVE":
      return "WITH_RECURSIVE";
    case "GROUP":
      return n1 === "BY" ? "GROUP_BY" : undefined;
    case "SETS":
      return "GROUPING_SETS";
    case "ORDER":
      return n1 === "BY" ? "ORDER_BY" : undefined;
    case "BY":
      return undefined;
    case "FETCH":
      return n1 === "FIRST" || n1 === "NEXT" ? "LIMIT" : undefined;
    case "CROSS":
      return n1 === "JOIN" ? "CROSS_JOIN" : undefined;
    case "NATURAL":
      return "JOIN";
    case "IS":
      if (n1 === "DISTINCT" || (n1 === "NOT" && n2 === "DISTINCT")) return "IS_DISTINCT";
      return n1 === "NULL" || (n1 === "NOT" && n2 === "NULL") ? "IS_NULL" : undefined;
    case "NOT":
      if (n1 === "IN") return "IN";
      if (n1 === "BETWEEN") return "BETWEEN";
      if (n1 === "LIKE") return "LIKE";
      if (n1 === "EXISTS") return "EXISTS";
      return n1 === "NULL" || n1 === "DISTINCT" ? undefined : "LOGICAL";
    case "AT":
      return n1 === "TIME" && n2 === "ZONE" ? "AT_TIME_ZONE" : undefined;
    case "CREATE": {
      const { obj, rest } = object();
      if (obj === "TABLE") {
        // CREATE TABLE t AS … (an `AS` before any column list).
        const paren = rest.indexOf("(");
        const as = rest.indexOf("AS");
        return as >= 0 && (paren < 0 || as < paren) ? "CREATE_TABLE_AS" : "CREATE_TABLE";
      }
      return ({ VIEW: "CREATE_VIEW", "MATERIALIZED VIEW": "CREATE_MATERIALIZED_VIEW", SCHEMA: "CREATE_SCHEMA" } as Record<string, string>)[obj];
    }
    case "ALTER":
      return ({ TABLE: "ALTER_TABLE", VIEW: "ALTER_VIEW", SCHEMA: "ALTER_SCHEMA" } as Record<string, string>)[n1];
    case "DROP": {
      const { obj } = object();
      return ({ TABLE: "DROP_TABLE", VIEW: "DROP_VIEW", "MATERIALIZED VIEW": "DROP_MATERIALIZED_VIEW", SCHEMA: "DROP_SCHEMA" } as Record<string, string>)[obj];
    }
    case "SHOW":
      return ({
        CATALOGS: "SHOW_CATALOGS", SCHEMAS: "SHOW_SCHEMAS", TABLES: "SHOW_TABLES", COLUMNS: "SHOW_COLUMNS",
        CREATE: "SHOW_CREATE", FUNCTIONS: "SHOW_FUNCTIONS", SESSION: "SHOW_SESSION", STATS: "SHOW_STATS",
      } as Record<string, string>)[n1];
    case "EXPLAIN":
      return n1 === "ANALYZE" ? "EXPLAIN_ANALYZE" : "EXPLAIN";
    case "SET":
      return n1 === "SESSION" ? "SET_SESSION" : undefined;
    case "RESET":
      return n1 === "SESSION" ? "RESET_SESSION" : undefined;
    case "START":
      return n1 === "TRANSACTION" ? "START_TRANSACTION" : undefined;
  }
  return SIMPLE_TOPICS[word];
}

// ---------------------------------------------------------------- types

const TYPES: Record<string, [anchor: string, summary: string]> = {
  BOOLEAN: ["boolean", "TRUE, FALSE or NULL."],
  TINYINT: ["tinyint", "8-bit signed integer (-128 to 127)."],
  SMALLINT: ["smallint", "16-bit signed integer."],
  INTEGER: ["integer", "32-bit signed integer (also `INT`)."],
  INT: ["integer", "32-bit signed integer (also `INTEGER`)."],
  BIGINT: ["bigint", "64-bit signed integer."],
  REAL: ["real", "32-bit floating point number."],
  DOUBLE: ["double", "64-bit floating point number."],
  DECIMAL: ["decimal", "Exact decimal number with `precision` digits, `scale` of them after the point: `DECIMAL(p, s)`."],
  VARCHAR: ["varchar", "Variable-length text, optionally with a maximum length: `VARCHAR(n)`."],
  CHAR: ["char", "Fixed-length text, padded with spaces: `CHAR(n)`."],
  VARBINARY: ["varbinary", "Variable-length binary data."],
  JSON: ["json", "A JSON value: object, array, number, string, boolean or null."],
  DATE: ["date", "Calendar date without time zone; literal `DATE '2024-01-31'`."],
  TIME: ["time", "Time of day without date: `TIME(p)`, optionally `WITH TIME ZONE`."],
  TIMESTAMP: ["timestamp", "Date and time with `p` fractional digits (default 3): `TIMESTAMP(p)`, optionally `WITH TIME ZONE`; literal `TIMESTAMP '2024-01-31 10:00:00'`."],
  INTERVAL: ["interval-day-to-second", "A span of time: `INTERVAL YEAR TO MONTH` or `INTERVAL DAY TO SECOND`; literal `INTERVAL '3' DAY`."],
  ARRAY: ["array", "Ordered collection of elements of one type: `ARRAY(T)`; literal `ARRAY[1, 2, 3]`."],
  MAP: ["map", "Key / value pairs: `MAP(K, V)`."],
  ROW: ["row", "A structure of named fields: `ROW(name T, …)`; fields are read with `row.name`."],
  IPADDRESS: ["ipaddress", "An IPv4 or IPv6 address."],
  UUID: ["uuid", "A universally unique identifier (UUID)."],
  HYPERLOGLOG: ["hyperloglog", "A sketch for approximate distinct counts (`approx_set`, `cardinality`)."],
};

const TYPE_ENTRIES: Record<string, TrinoDocEntry> = Object.fromEntries(
  Object.entries(TYPES).map(([name, [anchor, summary]]) => [
    name,
    { id: `type:${name}`, title: name, kind: "type", summary, page: `language/types#${anchor}` },
  ]),
);

// ---------------------------------------------------------------- lookup

export interface DocContext {
  /** Words after the hovered word (upper-case; `(` and `;` included). */
  next?: string[];
  /** The word is followed by `(`. */
  call?: boolean;
}

/** Help for a built-in function, if it is one. */
export function functionDoc(name: string): TrinoDocEntry | undefined {
  return FUNCTIONS.get(name.toLowerCase());
}

/** Built-ins written without parentheses. */
const NO_PAREN = new Set(["current_date", "current_time", "current_timestamp"]);

/** Help for a word: a built-in function, keyword / clause / statement or data type. */
export function docFor(word: string, context: DocContext = {}): TrinoDocEntry | undefined {
  const upper = word.toUpperCase();
  const next = (context.next ?? []).map((w) => w.toUpperCase());
  // `count(*) FILTER (WHERE …)` is the aggregation clause, not filter().
  if (upper === "FILTER" && next[0] === "(" && next[1] === "WHERE") return TOPIC_ENTRIES.FILTER;
  const fn = functionDoc(word);
  if (fn && context.call) return fn;
  const topic = keywordTopic(upper, next);
  if (topic) return TOPIC_ENTRIES[topic];
  if (TYPE_ENTRIES[upper]) return TYPE_ENTRIES[upper];
  return fn && NO_PAREN.has(fn.title) ? fn : undefined;
}

/** Every help entry (for translation coverage and link checking). */
export function allDocEntries(): TrinoDocEntry[] {
  return [...FUNCTIONS.values(), ...Object.values(TOPIC_ENTRIES), ...Object.values(TYPE_ENTRIES)];
}

/** Markdown for a help topic in `locale`, linked to the Trino documentation. */
export function renderDoc(entry: TrinoDocEntry, locale?: TrinoLocale): string {
  const t = uiStrings(locale);
  const e = localizeDoc(entry, locale);
  const out: string[] = [`**${e.title}** — ${t.docKind[e.kind]}`];
  if (e.syntax) out.push("```sql\n" + e.syntax + "\n```");
  if (e.summary) out.push(e.summary);
  if (e.example) out.push(t.example + "\n```sql\n" + e.example + "\n```");
  out.push(`[${t.documentation}](${docUrl(e.page)})`);
  return out.join("\n\n");
}
