# Reads the legacy inventory workbook (.xls) with the Windows OLE DB driver and writes it as UTF-8 CSV.
# Usage: powershell -File extract.ps1 -Source "D:\Rodalaser\docs\INVENTARIO ALMACEN 2026.xls" -Out "D:\Rodalaser\docs\migracion-2026\inventario-2026.csv"
# Needs the "Microsoft.ACE.OLEDB.12.0" provider (Access Database Engine). Nothing is written back to the workbook.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'
$connection = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$Source;Extended Properties='Excel 8.0;HDR=NO;IMEX=1'")
$connection.Open()
try {
  $sheet = ($connection.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, $null) | Select-Object -First 1).TABLE_NAME
  $adapter = New-Object System.Data.OleDb.OleDbDataAdapter("SELECT * FROM [$sheet]", $connection)
  $table = New-Object System.Data.DataTable
  [void]$adapter.Fill($table)
} finally {
  $connection.Close()
}

New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
# row 0 is the report title and row 1 the header: the CSV keeps the header and every row after it, as text
$lines = for ($i = 1; $i -lt $table.Rows.Count; $i++) {
  ($table.Rows[$i].ItemArray | ForEach-Object { '"' + (("$_").Replace('"', '""')) + '"' }) -join ','
}
[System.IO.File]::WriteAllLines($Out, $lines, (New-Object System.Text.UTF8Encoding($false)))
"Wrote $($lines.Count) lines to $Out"
