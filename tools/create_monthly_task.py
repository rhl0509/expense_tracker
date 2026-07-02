"""XML 작업 스케줄러 파일 생성 후 schtasks로 등록."""
import sys, subprocess
from pathlib import Path

xml_path = Path(sys.argv[1])
username = sys.argv[2] if len(sys.argv) > 2 else ""

xml = (
    '<?xml version="1.0" encoding="UTF-16"?>\n'
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n'
    '  <RegistrationInfo/>\n'
    '  <Triggers>\n'
    '    <CalendarTrigger>\n'
    '      <StartBoundary>2026-06-01T06:00:00</StartBoundary>\n'
    '      <Enabled>true</Enabled>\n'
    '      <ScheduleByMonth>\n'
    '        <DaysOfMonth><Day>1</Day></DaysOfMonth>\n'
    '        <Months><January/><February/><March/><April/><May/><June/>'
    '<July/><August/><September/><October/><November/><December/></Months>\n'
    '      </ScheduleByMonth>\n'
    '    </CalendarTrigger>\n'
    '  </Triggers>\n'
    '  <Principals><Principal id="Author">'
    '<LogonType>InteractiveToken</LogonType>'
    '<RunLevel>HighestAvailable</RunLevel>'
    '</Principal></Principals>\n'
    '  <Settings>'
    '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'
    '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'
    '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'
    '<StartWhenAvailable>true</StartWhenAvailable>'
    '<ExecutionTimeLimit>PT6H</ExecutionTimeLimit>'
    '</Settings>\n'
    '  <Actions Context="Author"><Exec>'
    '<Command>D:\\expense_tracker\\run_monthly.bat</Command>'
    '</Exec></Actions>\n'
    '</Task>'
)

xml_path.write_text(xml, encoding="utf-16")
print(f"XML written: {xml_path}")
