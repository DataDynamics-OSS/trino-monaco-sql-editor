/**
 * Trino SQL language elements.
 *
 * These lists are compiled from the public Trino SQL reference documentation
 * (https://trino.io/docs/ — "SQL statement syntax", "Reserved keywords" and the
 * function reference). They are factual language data, shipped statically so the
 * editor works fully offline. Override/extend them via the `languageElements`
 * prop on `<TrinoEditor />` (e.g. to inject catalog-specific UDFs).
 */

/** Reserved + non-reserved keywords (Trino grammar). */
export const TRINO_KEYWORDS: string[] = [
  "ABSENT", "ADD", "ADMIN", "AFTER", "ALL", "ALTER", "ANALYZE", "AND", "ANY",
  "ARRAY", "AS", "ASC", "AT", "AUTHORIZATION", "BERNOULLI", "BETWEEN", "BOTH",
  "BY", "CALL", "CASCADE", "CASE", "CAST", "CATALOG", "CATALOGS", "COLUMN",
  "COLUMNS", "COMMENT", "COMMIT", "COMMITTED", "CONDITIONAL", "CONSTRAINT",
  "COPARTITION", "CREATE", "CROSS", "CUBE", "CURRENT", "CURRENT_CATALOG",
  "CURRENT_DATE", "CURRENT_PATH", "CURRENT_ROLE", "CURRENT_SCHEMA",
  "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "DATA", "DATE", "DAY",
  "DEALLOCATE", "DECLARE", "DEFAULT", "DEFINE", "DEFINER", "DELETE", "DENY",
  "DESC", "DESCRIBE", "DESCRIPTOR", "DISTINCT", "DISTRIBUTED", "DOUBLE", "DROP",
  "ELSE", "EMPTY", "ENCODING", "END", "ERROR", "ESCAPE", "EXCEPT", "EXCLUDING",
  "EXECUTE", "EXISTS", "EXPLAIN", "EXTRACT", "FALSE", "FETCH", "FILTER", "FINAL",
  "FIRST", "FOLLOWING", "FOR", "FORMAT", "FROM", "FULL", "FUNCTION", "FUNCTIONS",
  "GRANT", "GRANTED", "GRANTS", "GRAPHVIZ", "GROUP", "GROUPING", "GROUPS",
  "HAVING", "HOUR", "IF", "IGNORE", "IN", "INCLUDING", "INITIAL", "INNER",
  "INPUT", "INSERT", "INTERSECT", "INTERVAL", "INTO", "INVOKER", "IO", "IS",
  "ISOLATION", "JSON", "JSON_ARRAY", "JSON_EXISTS", "JSON_OBJECT", "JSON_QUERY",
  "JSON_TABLE", "JSON_VALUE", "JOIN", "KEEP", "KEY", "KEYS", "LANGUAGE", "LAST",
  "LATERAL", "LEADING", "LEAVE", "LEFT", "LEVEL", "LIKE", "LIMIT", "LISTAGG",
  "LOCAL", "LOCALTIME", "LOCALTIMESTAMP", "LOGICAL", "MAP", "MATCH", "MATCHED",
  "MATCHES", "MATCH_RECOGNIZE", "MATERIALIZED", "MEASURES", "MERGE", "MINUTE",
  "MONTH", "NATURAL", "NESTED", "NEXT", "NFC", "NFD", "NFKC", "NFKD", "NO",
  "NONE", "NORMALIZE", "NOT", "NULL", "NULLIF", "NULLS", "OBJECT", "OF",
  "OFFSET", "OMIT", "ON", "ONE", "ONLY", "OPTION", "OR", "ORDER", "ORDINALITY",
  "OUTER", "OUTPUT", "OVER", "OVERFLOW", "PARTITION", "PARTITIONS", "PASSING",
  "PAST", "PATH", "PATTERN", "PER", "PERIOD", "PERMUTE", "PLAN", "POSITION",
  "PRECEDING", "PRECISION", "PREPARE", "PRIVILEGES", "PROPERTIES", "PRUNE",
  "QUOTES", "RANGE", "READ", "RECURSIVE", "REFRESH", "RENAME", "REPEATABLE",
  "REPLACE", "RESET", "RESPECT", "RESTRICT", "RETURN", "RETURNING", "RETURNS",
  "REVOKE", "RIGHT", "ROLE", "ROLES", "ROLLBACK", "ROLLUP", "ROW", "ROWS",
  "RUNNING", "SCALAR", "SCHEMA", "SCHEMAS", "SECOND", "SECURITY", "SEEK",
  "SELECT", "SERIALIZABLE", "SESSION", "SET", "SETS", "SHOW", "SKIP", "SOME",
  "START", "STATS", "SUBSET", "SUBSTRING", "SYSTEM", "TABLE", "TABLES",
  "TABLESAMPLE", "TEXT", "THEN", "TIES", "TIME", "TIMESTAMP", "TO", "TRAILING",
  "TRANSACTION", "TRIM", "TRUE", "TRUNCATE", "TRY_CAST", "TYPE", "UESCAPE",
  "UNBOUNDED", "UNCOMMITTED", "UNCONDITIONAL", "UNION", "UNIQUE", "UNKNOWN",
  "UNMATCHED", "UNNEST", "UPDATE", "USE", "USER", "USING", "UTF16", "UTF32",
  "UTF8", "VALIDATE", "VALUE", "VALUES", "VERBOSE", "VIEW", "WHEN", "WHERE",
  "WHILE", "WINDOW", "WITH", "WITHIN", "WITHOUT", "WORK", "WRAPPER", "WRITE",
  "YEAR", "ZONE",
];

/** Common Trino scalar / aggregate / window built-in functions. */
export const TRINO_FUNCTIONS: string[] = [
  // aggregate
  "approx_distinct", "approx_percentile", "arbitrary", "array_agg", "avg",
  "bool_and", "bool_or", "checksum", "corr", "count", "count_if", "covar_pop",
  "covar_samp", "every", "geometric_mean", "histogram", "listagg", "max",
  "max_by", "min", "min_by", "multimap_agg", "regr_intercept", "regr_slope",
  "skewness", "stddev", "stddev_pop", "stddev_samp", "sum", "variance", "var_pop",
  "var_samp",
  // window
  "cume_dist", "dense_rank", "first_value", "lag", "last_value", "lead",
  "nth_value", "ntile", "percent_rank", "rank", "row_number",
  // array / map
  "array_distinct", "array_intersect", "array_join", "array_max", "array_min",
  "array_position", "array_remove", "array_sort", "array_union", "cardinality",
  "contains", "element_at", "filter", "flatten", "map", "map_agg",
  "map_concat", "map_entries", "map_filter", "map_keys", "map_values",
  "reduce", "sequence", "slice", "transform", "zip", "zip_with",
  // string
  "chr", "codepoint", "concat", "concat_ws", "format", "from_utf8", "length",
  "levenshtein_distance", "lower", "lpad", "ltrim", "regexp_extract",
  "regexp_extract_all", "regexp_like", "regexp_replace", "regexp_split",
  "replace", "reverse", "rpad", "rtrim", "split", "split_part", "strpos",
  "substr", "substring", "to_utf8", "trim", "upper", "word_stem",
  // datetime
  "current_date", "current_time", "current_timestamp", "date", "date_add",
  "date_diff", "date_format", "date_parse", "date_trunc", "day", "day_of_month",
  "day_of_week", "day_of_year", "format_datetime", "from_iso8601_date",
  "from_iso8601_timestamp", "from_unixtime", "hour", "minute", "month", "now",
  "parse_datetime", "quarter", "second", "to_iso8601", "to_unixtime", "week",
  "year",
  // math
  "abs", "acos", "asin", "atan", "atan2", "cbrt", "ceil", "ceiling", "cos",
  "cosh", "degrees", "e", "exp", "floor", "from_base", "greatest", "least",
  "ln", "log", "log2", "log10", "mod", "pi", "pow", "power", "radians",
  "rand", "random", "round", "sign", "sin", "sqrt", "tan", "tanh", "to_base",
  "truncate", "width_bucket",
  // json
  "json_array_contains", "json_array_get", "json_array_length", "json_extract",
  "json_extract_scalar", "json_format", "json_parse", "json_size",
  // conditional / conversion / misc
  "cast", "coalesce", "if", "nullif", "try", "try_cast", "typeof",
];

/** Operator words that tokenize as operators. */
export const TRINO_OPERATORS: string[] = [
  "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "IS", "NULL", "EXISTS", "ALL",
  "ANY", "SOME", "AS", "ON", "USING",
];

/** Trino scalar/complex data types (used for type hints in completion). */
export const TRINO_TYPES: string[] = [
  "BIGINT", "INTEGER", "INT", "SMALLINT", "TINYINT", "BOOLEAN", "DOUBLE",
  "REAL", "DECIMAL", "VARCHAR", "CHAR", "VARBINARY", "JSON", "DATE", "TIME",
  "TIMESTAMP", "INTERVAL", "ARRAY", "MAP", "ROW", "IPADDRESS", "UUID", "HYPERLOGLOG",
];

export interface TrinoLanguageElements {
  keywords: string[];
  functions: string[];
  operators: string[];
  types: string[];
}

export const DEFAULT_LANGUAGE_ELEMENTS: TrinoLanguageElements = {
  keywords: TRINO_KEYWORDS,
  functions: TRINO_FUNCTIONS,
  operators: TRINO_OPERATORS,
  types: TRINO_TYPES,
};

/** Merge a partial override over the built-in language elements. */
export function resolveLanguageElements(
  partial?: Partial<TrinoLanguageElements>,
): TrinoLanguageElements {
  return {
    keywords: partial?.keywords ?? DEFAULT_LANGUAGE_ELEMENTS.keywords,
    functions: partial?.functions ?? DEFAULT_LANGUAGE_ELEMENTS.functions,
    operators: partial?.operators ?? DEFAULT_LANGUAGE_ELEMENTS.operators,
    types: partial?.types ?? DEFAULT_LANGUAGE_ELEMENTS.types,
  };
}
