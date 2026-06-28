/*
 * A focused Trino SQL grammar for context-aware completion (antlr4-c3).
 *
 * Covers the common statement surface — queries (SELECT / WITH / set ops /
 * VALUES), DML (INSERT / UPDATE / DELETE / MERGE) and DDL/utility
 * (CREATE / DROP / ALTER / TRUNCATE / SHOW / DESCRIBE / EXPLAIN / USE / CALL),
 * plus expressions (functions, CASE, CAST, qualified names). It is intentionally
 * reduced — not the full Trino grammar.
 *
 * The "preferred rules" the completion engine keys on:
 *   - tableRef     : an existing table is expected here
 *   - columnRef    : an existing column / qualified reference is expected here
 *   - functionName : a function name is expected here
 * New-object names (CREATE targets, column definitions) use plain
 * identifier/qualifiedName so they do NOT trigger existing-object suggestions.
 *
 * Inspired by the structure of Trino's SqlBase.g4 (Apache-2.0); written from
 * scratch and intentionally reduced.
 */
grammar TrinoSql;

options { caseInsensitive = true; }

// ============================ Parser rules ============================

root
    : statements? EOF
    ;

statements
    : statement (SEMICOLON statement)* SEMICOLON?
    ;

statement
    : query
    | insertStatement
    | deleteStatement
    | updateStatement
    | mergeStatement
    | createTableStatement
    | createViewStatement
    | createSchemaStatement
    | dropStatement
    | alterTableStatement
    | truncateStatement
    | showStatement
    | describeStatement
    | useStatement
    | callStatement
    | explainStatement
    ;

// ----- Queries -----

query
    : withClause? queryExpressionBody orderByClause? limitClause?
    ;

withClause
    : WITH namedQuery (COMMA namedQuery)*
    ;

namedQuery
    : identifier columnAliases? AS LPAREN query RPAREN
    ;

columnAliases
    : LPAREN identifier (COMMA identifier)* RPAREN
    ;

queryExpressionBody
    : queryPrimary
    | queryExpressionBody (UNION | INTERSECT | EXCEPT) setQuantifier? queryPrimary
    ;

queryPrimary
    : querySpecification
    | valuesClause
    | LPAREN query RPAREN
    ;

valuesClause
    : VALUES expression (COMMA expression)*
    ;

querySpecification
    : SELECT setQuantifier? selectItem (COMMA selectItem)*
      fromClause?
      whereClause?
      groupByClause?
      havingClause?
    ;

fromClause    : FROM relation (COMMA relation)* ;
whereClause   : WHERE booleanExpression ;
groupByClause : GROUP BY expression (COMMA expression)* ;
havingClause  : HAVING booleanExpression ;

setQuantifier : DISTINCT | ALL ;

selectItem
    : ASTERISK
    | expression (AS? identifier)?
    ;

relation
    : relation joinType JOIN relation joinCriteria?   # joinRelation
    | aliasedRelation                                 # relationDefault
    ;

joinType
    : INNER?
    | LEFT OUTER?
    | RIGHT OUTER?
    | FULL OUTER?
    | CROSS
    ;

joinCriteria
    : ON booleanExpression
    | USING LPAREN identifier (COMMA identifier)* RPAREN
    ;

aliasedRelation
    : relationPrimary (AS? identifier)?
    ;

relationPrimary
    : tableRef
    | LPAREN query RPAREN
    | LPAREN relation RPAREN
    ;

// preferred rule: an existing table is expected here
tableRef
    : qualifiedName
    ;

orderByClause
    : ORDER BY sortItem (COMMA sortItem)*
    ;

sortItem
    : expression (ASC | DESC)?
    ;

limitClause
    : LIMIT (INTEGER_VALUE | ALL)
    ;

// ----- DML -----

insertStatement
    : INSERT INTO tableRef columnRefList? queryOrValues
    ;

queryOrValues
    : query
    ;

columnRefList
    : LPAREN columnRef (COMMA columnRef)* RPAREN
    ;

deleteStatement
    : DELETE FROM tableRef (WHERE booleanExpression)?
    ;

updateStatement
    : UPDATE tableRef SET updateAssignment (COMMA updateAssignment)* (WHERE booleanExpression)?
    ;

updateAssignment
    : columnRef EQ expression
    ;

mergeStatement
    : MERGE INTO tableRef (AS? identifier)? USING relation ON booleanExpression mergeCase+
    ;

mergeCase
    : WHEN MATCHED (AND booleanExpression)? THEN mergeUpdateOrDelete
    | WHEN NOT MATCHED (AND booleanExpression)? THEN
        INSERT columnRefList? VALUES LPAREN expression (COMMA expression)* RPAREN
    ;

mergeUpdateOrDelete
    : UPDATE SET updateAssignment (COMMA updateAssignment)*
    | DELETE
    ;

// ----- DDL / utility -----

createTableStatement
    : CREATE TABLE (IF NOT EXISTS)? qualifiedName
      ( LPAREN tableElement (COMMA tableElement)* RPAREN )?
      ( AS query )?
    ;

tableElement
    : identifier type?
    ;

createViewStatement
    : CREATE (OR REPLACE)? VIEW qualifiedName AS query
    ;

createSchemaStatement
    : CREATE SCHEMA (IF NOT EXISTS)? qualifiedName
    ;

dropStatement
    : DROP TABLE (IF EXISTS)? tableRef     # dropTable
    | DROP VIEW (IF EXISTS)? tableRef      # dropView
    | DROP SCHEMA (IF EXISTS)? qualifiedName # dropSchema
    ;

alterTableStatement
    : ALTER TABLE (IF EXISTS)? tableRef
      ( RENAME TO qualifiedName
      | ADD COLUMN (IF NOT EXISTS)? tableElement
      | DROP COLUMN (IF EXISTS)? columnRef
      | RENAME COLUMN columnRef TO identifier
      )
    ;

truncateStatement
    : TRUNCATE TABLE tableRef
    ;

showStatement
    : SHOW TABLES ((FROM | IN) qualifiedName)? (LIKE STRING)?   # showTables
    | SHOW SCHEMAS ((FROM | IN) identifier)? (LIKE STRING)?     # showSchemas
    | SHOW CATALOGS (LIKE STRING)?                              # showCatalogs
    | SHOW COLUMNS (FROM | IN) tableRef                         # showColumns
    | SHOW CREATE TABLE tableRef                                # showCreateTable
    | SHOW CREATE VIEW tableRef                                 # showCreateView
    ;

describeStatement
    : (DESCRIBE | DESC) tableRef
    ;

useStatement
    : USE (identifier DOT)? identifier
    ;

callStatement
    : CALL qualifiedName LPAREN (expression (COMMA expression)*)? RPAREN
    ;

explainStatement
    : EXPLAIN (ANALYZE)? (VERBOSE)? statement
    ;

// ----- Expressions -----

expression
    : booleanExpression
    ;

booleanExpression
    : NOT booleanExpression
    | booleanExpression AND booleanExpression
    | booleanExpression OR booleanExpression
    | predicate
    ;

predicate
    : valueExpression IS NOT? NULL
    | valueExpression NOT? IN LPAREN expression (COMMA expression)* RPAREN
    | valueExpression NOT? IN LPAREN query RPAREN
    | valueExpression NOT? BETWEEN valueExpression AND valueExpression
    | valueExpression NOT? LIKE valueExpression
    | valueExpression comparisonOperator valueExpression
    | valueExpression
    ;

comparisonOperator
    : EQ | NEQ | LT | LTE | GT | GTE
    ;

valueExpression
    : valueExpression (ASTERISK | SLASH | PERCENT) valueExpression
    | valueExpression (PLUS | MINUS) valueExpression
    | primaryExpression
    ;

primaryExpression
    : literal
    | CASE whenClause+ (ELSE expression)? END
    | CAST LPAREN expression AS type RPAREN
    | functionCall
    | columnRef
    | LPAREN query RPAREN
    | LPAREN expression RPAREN
    ;

whenClause
    : WHEN expression THEN expression
    ;

// preferred rule: a function name is expected here
functionCall
    : functionName LPAREN (setQuantifier? (ASTERISK | expression (COMMA expression)*))? RPAREN
    ;

functionName
    : identifier
    ;

// preferred rule: a column / qualified reference is expected here
columnRef
    : qualifiedName
    ;

literal
    : NULL | TRUE | FALSE | INTEGER_VALUE | DECIMAL_VALUE | STRING
    ;

type
    : identifier (LPAREN typeParam (COMMA typeParam)* RPAREN)?
    ;

typeParam
    : INTEGER_VALUE
    | type
    ;

qualifiedName
    : identifier (DOT identifier)*
    ;

identifier
    : IDENTIFIER
    | QUOTED_IDENTIFIER
    ;

// ============================ Lexer rules ============================

// keywords (MUST all precede the punctuation/operator/literal block below,
// because the completion core treats everything from LPAREN onward as ignored)
SELECT    : 'SELECT';
DISTINCT  : 'DISTINCT';
ALL       : 'ALL';
FROM      : 'FROM';
WHERE     : 'WHERE';
GROUP     : 'GROUP';
BY        : 'BY';
HAVING    : 'HAVING';
ORDER     : 'ORDER';
LIMIT     : 'LIMIT';
WITH      : 'WITH';
AS        : 'AS';
JOIN      : 'JOIN';
INNER     : 'INNER';
LEFT      : 'LEFT';
RIGHT     : 'RIGHT';
FULL      : 'FULL';
OUTER     : 'OUTER';
CROSS     : 'CROSS';
ON        : 'ON';
USING     : 'USING';
AND       : 'AND';
OR        : 'OR';
NOT       : 'NOT';
IN        : 'IN';
IS        : 'IS';
NULL      : 'NULL';
TRUE      : 'TRUE';
FALSE     : 'FALSE';
LIKE      : 'LIKE';
BETWEEN   : 'BETWEEN';
ASC       : 'ASC';
DESC      : 'DESC';
UNION     : 'UNION';
INTERSECT : 'INTERSECT';
EXCEPT    : 'EXCEPT';
VALUES    : 'VALUES';
INSERT    : 'INSERT';
INTO      : 'INTO';
DELETE    : 'DELETE';
UPDATE    : 'UPDATE';
SET       : 'SET';
MERGE     : 'MERGE';
MATCHED   : 'MATCHED';
WHEN      : 'WHEN';
THEN      : 'THEN';
ELSE      : 'ELSE';
END       : 'END';
CASE      : 'CASE';
CAST      : 'CAST';
CREATE    : 'CREATE';
REPLACE   : 'REPLACE';
TABLE     : 'TABLE';
VIEW      : 'VIEW';
SCHEMA    : 'SCHEMA';
IF        : 'IF';
EXISTS    : 'EXISTS';
DROP      : 'DROP';
ALTER     : 'ALTER';
RENAME    : 'RENAME';
TO        : 'TO';
ADD       : 'ADD';
COLUMN    : 'COLUMN';
TRUNCATE  : 'TRUNCATE';
SHOW      : 'SHOW';
TABLES    : 'TABLES';
SCHEMAS   : 'SCHEMAS';
CATALOGS  : 'CATALOGS';
COLUMNS   : 'COLUMNS';
DESCRIBE  : 'DESCRIBE';
USE       : 'USE';
CALL      : 'CALL';
EXPLAIN   : 'EXPLAIN';
ANALYZE   : 'ANALYZE';
VERBOSE   : 'VERBOSE';

// punctuation / operators
LPAREN    : '(';
RPAREN    : ')';
COMMA     : ',';
DOT       : '.';
SEMICOLON : ';';
ASTERISK  : '*';
SLASH     : '/';
PERCENT   : '%';
PLUS      : '+';
MINUS     : '-';
EQ        : '=';
NEQ       : '<>' | '!=';
LTE       : '<=';
GTE       : '>=';
LT        : '<';
GT        : '>';

// literals & identifiers
STRING            : '\'' ( ~'\'' | '\'\'' )* '\'' ;
DECIMAL_VALUE     : DIGIT+ '.' DIGIT* | '.' DIGIT+ ;
INTEGER_VALUE     : DIGIT+ ;
IDENTIFIER        : (LETTER | '_') (LETTER | DIGIT | '_' | '@' | '#' | '$')* ;
QUOTED_IDENTIFIER : '"' ( ~'"' | '""' )* '"' ;

fragment DIGIT  : [0-9] ;
fragment LETTER : [A-Z] ;   // caseInsensitive option also matches a-z

LINE_COMMENT  : '--' ~[\r\n]* -> channel(HIDDEN) ;
BLOCK_COMMENT : '/*' .*? '*/' -> channel(HIDDEN) ;
WS            : [ \t\r\n]+ -> channel(HIDDEN) ;
