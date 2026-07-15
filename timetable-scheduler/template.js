// template.js - Excel template download, upload, and validation using SheetJS (xlsx)

const ExcelTemplateManager = (() => {
    
    // Config: sheet definitions and expected columns
    const SCHEMA = {
        Setup: {
            columns: ["Parameter", "Value", "Description"],
            requiredRows: ["Start Date", "End Date"]
        },
        Resources: {
            columns: ["Resource Name", "Absent Dates", "Min Hours", "Max Hours"]
        },
        Departments: {
            columns: ["Department Name", "Min Total Hours", "Max Total Hours"]
        },
        Mappings: {
            columns: ["Resource Name", "Department Name", "Min Days", "Max Days"]
        }
    };

    // Helper to format date objects safely
    function formatDate(date) {
        let d = new Date(date),
            month = '' + (d.getMonth() + 1),
            day = '' + d.getDate(),
            year = d.getFullYear();

        if (month.length < 2) month = '0' + month;
        if (day.length < 2) day = '0' + day;

        return [year, month, day].join('-');
    }

    // 1. Download Template
    function downloadTemplate() {
        const wb = XLSX.utils.book_new();

        // Sheet 1: Setup
        const setupData = [
            ["Parameter", "Value", "Description"],
            ["Start Date", "2026-08-01", "Format: YYYY-MM-DD. Start date of roster period."],
            ["End Date", "2026-08-07", "Format: YYYY-MM-DD. End date of roster period."],
            ["Default Daily Work Hours", "8", "Default shift hours per day (typically 8)"]
        ];
        const wsSetup = XLSX.utils.aoa_to_sheet(setupData);
        XLSX.utils.book_append_sheet(wb, wsSetup, "Setup");

        // Sheet 2: Resources
        const resourcesData = [
            ["Resource Name", "Absent Dates", "Min Hours", "Max Hours"],
            ["Dr. Smith", "2026-08-01, 2026-08-02", 10, 40],
            ["Dr. Jones", "2026-08-05", 20, 48],
            ["Dr. Taylor", "", 15, 40]
        ];
        const wsResources = XLSX.utils.aoa_to_sheet(resourcesData);
        XLSX.utils.book_append_sheet(wb, wsResources, "Resources");

        // Sheet 3: Departments
        const departmentsData = [
            ["Department Name", "Min Total Hours", "Max Total Hours"],
            ["Cardiology", 16, 80],
            ["Emergency", 24, 120],
            ["Pediatrics", 8, 48]
        ];
        const wsDepartments = XLSX.utils.aoa_to_sheet(departmentsData);
        XLSX.utils.book_append_sheet(wb, wsDepartments, "Departments");

        // Sheet 4: Mappings
        const mappingsData = [
            ["Resource Name", "Department Name", "Min Days", "Max Days"],
            ["Dr. Smith", "Cardiology", 1, 3],
            ["Dr. Smith", "Emergency", 1, 2],
            ["Dr. Jones", "Emergency", 2, 4],
            ["Dr. Taylor", "Pediatrics", 1, 4],
            ["Dr. Taylor", "Cardiology", 1, 2]
        ];
        const wsMappings = XLSX.utils.aoa_to_sheet(mappingsData);
        XLSX.utils.book_append_sheet(wb, wsMappings, "Mappings");

        // Write file
        XLSX.writeFile(wb, "Scheduler_Template.xlsx");
    }

    // 2. Parse and Validate Workbook
    function parseAndValidate(arrayBuffer) {
        let workbook;
        try {
            const data = new Uint8Array(arrayBuffer);
            workbook = XLSX.read(data, { type: 'array' });
        } catch (e) {
            return { error: "Failed to read the Excel file. Please ensure it is a valid .xlsx or .xls file." };
        }

        const errors = [];
        const parsedData = {};

        // Verify sheet names
        for (const sheetName of Object.keys(SCHEMA)) {
            if (!workbook.SheetNames.includes(sheetName)) {
                errors.push(`Missing required Sheet: "${sheetName}"`);
                continue;
            }

            const sheet = workbook.Sheets[sheetName];
            // Get raw rows
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows.length === 0) {
                errors.push(`Sheet "${sheetName}" is empty.`);
                continue;
            }

            const headers = rows[0].map(h => String(h || '').trim());
            const expectedCols = SCHEMA[sheetName].columns;

            // Validate columns
            for (const col of expectedCols) {
                if (!headers.includes(col)) {
                    errors.push(`Sheet "${sheetName}" is missing required column: "${col}"`);
                }
            }

            if (errors.length > 0) continue;

            // Map rows to objects
            const sheetRows = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0 || row.every(cell => cell === null || cell === undefined || cell === '')) {
                    continue; // Skip empty rows
                }

                const rowObj = {};
                expectedCols.forEach(col => {
                    const colIndex = headers.indexOf(col);
                    rowObj[col] = colIndex !== -1 ? row[colIndex] : undefined;
                });
                
                rowObj._rowIndex = i + 1; // Excel row number (1-based, plus header offset)
                sheetRows.push(rowObj);
            }
            parsedData[sheetName] = sheetRows;
        }

        if (errors.length > 0) {
            return { errors };
        }

        // Deep Content Validation
        validateContent(parsedData, errors);

        if (errors.length > 0) {
            return { errors };
        }

        return { data: parsedData };
    }

    // 3. Detailed Cell Content and Constraints Validation
    function validateContent(data, errors) {
        // Validate Setup
        const setupMap = {};
        data.Setup.forEach(row => {
            const param = String(row["Parameter"] || '').trim();
            setupMap[param] = row["Value"];
        });

        const startDateStr = setupMap["Start Date"];
        const endDateStr = setupMap["End Date"];

        if (!startDateStr || !isValidDateString(startDateStr)) {
            errors.push(`Sheet [Setup]: "Start Date" value is invalid or empty. Expected format: YYYY-MM-DD`);
        }
        if (!endDateStr || !isValidDateString(endDateStr)) {
            errors.push(`Sheet [Setup]: "End Date" value is invalid or empty. Expected format: YYYY-MM-DD`);
        }

        if (startDateStr && endDateStr) {
            const start = new Date(startDateStr);
            const end = new Date(endDateStr);
            if (start > end) {
                errors.push(`Sheet [Setup]: "Start Date" (${startDateStr}) cannot be after "End Date" (${endDateStr})`);
            }
        }

        const defaultHours = Number(setupMap["Default Daily Work Hours"] || 8);
        if (isNaN(defaultHours) || defaultHours <= 0 || defaultHours > 24) {
            errors.push(`Sheet [Setup]: "Default Daily Work Hours" must be a positive number between 1 and 24.`);
        }

        // Validate Resources
        const resourceNames = new Set();
        data.Resources.forEach(row => {
            const name = String(row["Resource Name"] || '').trim();
            const rowIndex = row._rowIndex;

            if (!name) {
                errors.push(`Sheet [Resources], Row ${rowIndex}: "Resource Name" cannot be empty.`);
                return;
            }
            if (resourceNames.has(name)) {
                errors.push(`Sheet [Resources], Row ${rowIndex}: Duplicate Resource Name "${name}" detected.`);
            }
            resourceNames.add(name);

            // Validate Absent Dates (can be empty, or comma separated dates)
            const absentStr = String(row["Absent Dates"] || '').trim();
            if (absentStr) {
                const dates = absentStr.split(',').map(d => d.trim());
                dates.forEach(dStr => {
                    if (dStr && !isValidDateString(dStr)) {
                        errors.push(`Sheet [Resources], Row ${rowIndex}: Invalid absent date format "${dStr}". Expected YYYY-MM-DD.`);
                    }
                });
            }

            // Min / Max hours
            const minH = Number(row["Min Hours"] || 0);
            const maxH = Number(row["Max Hours"] || 0);

            if (isNaN(minH) || minH < 0) {
                errors.push(`Sheet [Resources], Row ${rowIndex}: "Min Hours" must be a valid positive number.`);
            }
            if (isNaN(maxH) || maxH < 0) {
                errors.push(`Sheet [Resources], Row ${rowIndex}: "Max Hours" must be a valid positive number.`);
            }
            if (!isNaN(minH) && !isNaN(maxH) && minH > maxH) {
                errors.push(`Sheet [Resources], Row ${rowIndex}: "Min Hours" (${minH}) cannot be greater than "Max Hours" (${maxH}).`);
            }
        });

        // Validate Departments
        const deptNames = new Set();
        data.Departments.forEach(row => {
            const name = String(row["Department Name"] || '').trim();
            const rowIndex = row._rowIndex;

            if (!name) {
                errors.push(`Sheet [Departments], Row ${rowIndex}: "Department Name" cannot be empty.`);
                return;
            }
            if (deptNames.has(name)) {
                errors.push(`Sheet [Departments], Row ${rowIndex}: Duplicate Department Name "${name}" detected.`);
            }
            deptNames.add(name);

            const minH = Number(row["Min Total Hours"] || 0);
            const maxH = Number(row["Max Total Hours"] || 0);

            if (isNaN(minH) || minH < 0) {
                errors.push(`Sheet [Departments], Row ${rowIndex}: "Min Total Hours" must be a valid positive number.`);
            }
            if (isNaN(maxH) || maxH < 0) {
                errors.push(`Sheet [Departments], Row ${rowIndex}: "Max Total Hours" must be a valid positive number.`);
            }
            if (!isNaN(minH) && !isNaN(maxH) && minH > maxH) {
                errors.push(`Sheet [Departments], Row ${rowIndex}: "Min Total Hours" (${minH}) cannot be greater than "Max Total Hours" (${maxH}).`);
            }
        });

        // Validate Mappings
        data.Mappings.forEach(row => {
            const rName = String(row["Resource Name"] || '').trim();
            const dName = String(row["Department Name"] || '').trim();
            const rowIndex = row._rowIndex;

            if (!rName) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: "Resource Name" cannot be empty.`);
            } else if (!resourceNames.has(rName)) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: Resource "${rName}" is not listed in the "Resources" sheet.`);
            }

            if (!dName) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: "Department Name" cannot be empty.`);
            } else if (!deptNames.has(dName)) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: Department "${dName}" is not listed in the "Departments" sheet.`);
            }

            const minD = Number(row["Min Days"] || 0);
            const maxD = Number(row["Max Days"] || 0);

            if (isNaN(minD) || minD < 0) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: "Min Days" must be a valid positive number.`);
            }
            if (isNaN(maxD) || maxD < 0) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: "Max Days" must be a valid positive number.`);
            }
            if (!isNaN(minD) && !isNaN(maxD) && minD > maxD) {
                errors.push(`Sheet [Mappings], Row ${rowIndex}: "Min Days" (${minD}) cannot be greater than "Max Days" (${maxD}).`);
            }
        });
    }

    // Basic date validator helper
    function isValidDateString(str) {
        // Handle sheetJS numeric date representation if read as serial number
        if (typeof str === 'number') {
            return true; 
        }
        if (str instanceof Date && !isNaN(str.getTime())) {
            return true;
        }
        const s = String(str).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        const d = new Date(s);
        return d instanceof Date && !isNaN(d.getTime());
    }

    return {
        downloadTemplate,
        parseAndValidate
    };

})();
