# Setup GitHub repo for zou-irbm-frontend
# Run from PowerShell: .\setup-github.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$repoName = "zou-irbm-frontend"
$branchName = "Tawananyashe"

Write-Host "=== Checking GitHub CLI ===" -ForegroundColor Cyan
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "GitHub CLI (gh) is not installed." -ForegroundColor Red
    Write-Host "Install from: https://cli.github.com/"
    exit 1
}

Write-Host "=== Checking GitHub authentication ===" -ForegroundColor Cyan
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Not logged in. Run: gh auth login" -ForegroundColor Yellow
    Write-Host "Choose: GitHub.com -> HTTPS -> Login with a web browser"
    Write-Host "GitHub no longer accepts account passwords for git push."
    exit 1
}

Write-Host "=== Initializing git (if needed) ===" -ForegroundColor Cyan
if (-not (Test-Path ".git")) {
    git init -b main
}

Write-Host "=== Creating initial commit (if needed) ===" -ForegroundColor Cyan
$hasCommits = git rev-parse HEAD 2>$null
if (-not $hasCommits) {
    git add -A
    git commit -m "Initial commit"
}

Write-Host "=== Creating branch '$branchName' ===" -ForegroundColor Cyan
$existingBranch = git branch --list $branchName
if (-not $existingBranch) {
    git branch $branchName
} else {
    Write-Host "Branch '$branchName' already exists."
}

Write-Host "=== Creating GitHub repository ===" -ForegroundColor Cyan
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
    gh repo create $repoName --source=. --remote=origin --public --description "ZOU IRBM Frontend"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create repo. It may already exist on your account." -ForegroundColor Yellow
        Write-Host "If it exists, add remote manually:"
        $username = gh api user -q .login
        Write-Host "  git remote add origin https://github.com/$username/$repoName.git"
        exit 1
    }
} else {
    Write-Host "Remote 'origin' already configured: $remoteUrl"
}

Write-Host "=== Pushing to main ===" -ForegroundColor Cyan
git push -u origin main

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
$username = gh api user -q .login
Write-Host "Repository: https://github.com/$username/$repoName"
Write-Host "Branches: main (pushed), $branchName (local)"
Write-Host ""
Write-Host "To push the feature branch later:"
Write-Host "  git push -u origin $branchName"
