param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'status', 'run', 'uninstall')]
    [string]$Action,

    [string]$NodePath,
    [string]$RunnerPath,
    [string]$WorkingDirectory,
    [ValidateRange(5, 1440)]
    [int]$IntervalMinutes = 10,
    [string]$TaskName = 'Nixie FoxWatch Monitor'
)

$ErrorActionPreference = 'Stop'

switch ($Action) {
    'install' {
        if (-not $NodePath -or -not $RunnerPath -or -not $WorkingDirectory) {
            throw 'NodePath, RunnerPath, and WorkingDirectory are required when installing the monitor task.'
        }

        $runnerArgument = '"{0}" monitor-once' -f $RunnerPath
        $taskAction = New-ScheduledTaskAction `
            -Execute $NodePath `
            -Argument $runnerArgument `
            -WorkingDirectory $WorkingDirectory
        $trigger = New-ScheduledTaskTrigger `
            -Once `
            -At (Get-Date).AddMinutes(1) `
            -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
        $settings = New-ScheduledTaskSettingsSet `
            -MultipleInstances IgnoreNew `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 5) `
            -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Hours 12)
        $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $principal = New-ScheduledTaskPrincipal `
            -UserId $userId `
            -LogonType Interactive `
            -RunLevel Limited

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $taskAction `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $principal `
            -Force | Out-Null

        [Console]::Out.Write("installed`t$TaskName`t$IntervalMinutes")
    }
    'status' {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $task) {
            [Console]::Out.Write("missing`t$TaskName")
            exit 0
        }
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        [Console]::Out.Write((
            "present`t{0}`t{1}`t{2:o}`t{3:o}`t{4}" -f `
                $task.State,
                $info.LastTaskResult,
                $info.LastRunTime,
                $info.NextRunTime,
                $TaskName
        ))
    }
    'run' {
        Start-ScheduledTask -TaskName $TaskName
        [Console]::Out.Write("started`t$TaskName")
    }
    'uninstall' {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            [Console]::Out.Write("removed`t$TaskName")
        } else {
            [Console]::Out.Write("missing`t$TaskName")
        }
    }
}
