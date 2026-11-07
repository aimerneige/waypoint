SELECT schemaname || '.' || tablename || ':' ||
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY schemaname, tablename;
