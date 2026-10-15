# Native Crane Defaults Regression Checks

Run from the repository root:

```powershell
dotnet run --project tools/foxwatch/tools/crane-default-tests/CraneDefaultTests.csproj -p:NuGetAudit=false
```

Uses synthetic CUE4Parse class/default objects and the actual production extractor, cache loader and authored pose binding. The project is excluded from production source by the existing tools/** boundary. No PAK, public output or server is needed.
