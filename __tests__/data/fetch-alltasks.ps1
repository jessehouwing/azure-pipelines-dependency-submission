[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Organization,

    [Parameter(Mandatory = $false)]
    [string]$AccessToken = $env:AZURE_DEVOPS_TOKEN,

    [Parameter(Mandatory = $false)]
    [switch]$SkipDownload
)

$scriptDir = $PSScriptRoot
$allTasksPath = Join-Path $scriptDir "alltasks.json"

if ($SkipDownload) {
    if (-not (Test-Path $allTasksPath)) {
        throw "Cannot skip download: alltasks.json does not exist at $allTasksPath"
    }
    Write-Output "::notice::Skipping download, using existing alltasks.json"
    $rawJson = Get-Content -Path $allTasksPath -Raw -Encoding UTF8
} else {
    if (-not $Organization) {
        throw "Organization is required when not using -SkipDownload."
    }
    if (-not $AccessToken) {
        throw "Access token is required. Provide it via -AccessToken parameter or set AZURE_DEVOPS_TOKEN environment variable."
    }

    $url = "https://dev.azure.com/$Organization"
    $header = @{authorization = "Basic $([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(".:$AccessToken")))"}

    Write-Output "::notice::Fetching all tasks from $Organization"

    $response = Invoke-RestMethod -Uri "$url/_apis/distributedtask/tasks?allversions=true" -Method Get -ContentType "application/json" -Headers $header

    # Write raw JSON to alltasks.json
    $rawJson = $response | ConvertTo-Json -Depth 100
    $rawJson | Set-Content -Path $allTasksPath -Encoding UTF8
}

# Parse as hashtable and write formatted JSON to alltasks-formatted.json
# Ensure the file is smaller than 100MB by removing tasks from the end if needed
$tasks = $rawJson | ConvertFrom-Json -AsHashtable
$maxSizeBytes = 100 * 1024 * 1024  # 100MB

$formattedPath = Join-Path $scriptDir "alltasks-formatted.json"

# Handle both cases: response with "value" property or direct array
if ($tasks -is [System.Collections.IDictionary] -and $tasks.ContainsKey("value")) {
    $taskList = [System.Collections.ArrayList]@($tasks["value"])
    
    do {
        $tasks["value"] = $taskList
        $json = $tasks | ConvertTo-Json -Depth 100
        $sizeBytes = [System.Text.Encoding]::UTF8.GetByteCount($json)
        
        if ($sizeBytes -gt $maxSizeBytes) {
            $removeCount = [Math]::Ceiling($taskList.Count * 0.05)  # Remove 5% of remaining tasks
            if ($removeCount -lt 1) { $removeCount = 1 }
            Write-Output "::warning::File size $([Math]::Round($sizeBytes / 1MB, 2))MB exceeds 100MB, removing $removeCount tasks..."
            while ($removeCount -gt 0 -and $taskList.Count -gt 0) {
                $taskList.RemoveAt($taskList.Count - 1)
                $removeCount--
            }
        }
    } while ($sizeBytes -gt $maxSizeBytes -and $taskList.Count -gt 0)
} else {
    # Response is already the task list or different structure
    $json = $tasks | ConvertTo-Json -Depth 100
    $sizeBytes = [System.Text.Encoding]::UTF8.GetByteCount($json)
}

# Update the count property to reflect the actual number of tasks
if ($tasks -is [System.Collections.IDictionary] -and $tasks.ContainsKey("count")) {
    $tasks["count"] = $taskList.Count
    $json = $tasks | ConvertTo-Json -Depth 100
}

$json | Set-Content -Path $formattedPath -Encoding UTF8

Write-Output "::notice::Successfully wrote alltasks.json and alltasks-formatted.json (final size: $([Math]::Round($sizeBytes / 1MB, 2))MB)"
