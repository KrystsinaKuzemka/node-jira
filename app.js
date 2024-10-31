const express = require('express');
require('dotenv').config();
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000;

const jiraApiKey = process.env.API_KEY;
const jiraURL = process.env.URL;
const jiraEmail = process.env.EMAIL;

const priorityKeywordsArray = [
    "asap","critical","severe","immediate attention","outage","major incident",
    "high priority","system down","escalation","blocking","impacting","urgent"
  ];  

    let users = [
         { email: 'k.v.kuzemko@gmail.com' }, 
    ];

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.post('/', async (req, res) => {
    
    //console.log(req);
    
    try {
        
    let data = req.body;
    let changelog = data.changelog;
    let issueId = data.issue.id;

    // console.log('Odebrano webhook:', data);
    // console.log(data.issue.fields.priority);
    // console.log(data.issue.fields.summary);
    // console.log(data.issue.fields.description);
    // console.log(data.webhookEvent); //typ eventu
    //console.log(data.issue.fields.status);
    // console.log(data.issue.fields.issuetype.name);    

    if(data.issue.fields.issuetype.name != "Bug" && data.webhookEvent == "jira:issue_created" ){
        workBalancer(issueId);
    }

    //generateReport();
    
    if(data.webhookEvent == "jira:issue_updated" || data.webhookEvent == "jira:issue_created"){
        
        if(changelog.items[0].fromString != changelog.items[0].toString){
         checkTasks();
        
         allTaskClosed();
        }

        let extractedData = data.issue.fields;
        let priority = extractedData.priority.name;

        if(priority != "High"){

            let description = extractedData.description;
            let summary = extractedData.summary;

            priorityKeywordsArray.forEach(el=>{
                if(description.toLowerCase().includes(el.toLowerCase()) || summary.toLowerCase().includes(el.toLowerCase())){
                    changePriority(issueId);
                }
            });
        }
    }

    if(data.webhookEvent == "jira:issue_updated"){ // tutaj w tym ifie problem 
            
            //console.log(data.issue.fields);

            if (data.issue.fields.parent && data.issue.fields.parent.id && data.issue.fields.parent.id.length > 0) {
                
                checkParentTask(data.issue.fields.parent.id);

            } else {
                checkSubtasks(issueId, data); //chyba ta 
            } 
    }
    
    if(data.webhookEvent == "jira:issue_created" || data.webhookEvent == "jira:issue_updated"){
        if(data.issue.fields.description == 'bug'){
            assigneTask("bug",issueId);
        }

        findDuplicates();
    }
    
  res.status(200).send('OK');

    } catch (error) {
          
         //console.log('#########################');

         //console.log(req.body);  

         console.log('#########################');

         console.log('Wystapil problem, zapisuje do pliku ' +error);

         console.log('#########################');

         fs.writeFile('last_error.txt', JSON.stringify(req.body, null, 2), (err) => {
            if (err) {
                console.error('Błąd podczas zapisywania pliku: ', err);
            } else {
                console.log('Zapisano req.body do pliku last_error.txt');
            }
        });

        console.log('#########################');

    }
});

    async function checkParentTask(id) {

        try {
            let response = await fetch(`${jiraURL}/rest/api/3/issue/${id}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json'
                }
            });

            let data = await response.json();
           
            checkSubtasksUsingParentID(id,data.fields.subtasks);

        }
        catch(e){
            console.error(e);
        }    
    }

    async function allTaskClosed(){

        try {
            // Pobranie wszystkich zadań
            let startAt = 0;
            const maxResults = 1000;
    
            let response = await fetch(`${jiraURL}/rest/api/3/search?maxResults=${maxResults}&startAt=${startAt}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json'
                }
            });
    
            const data = await response.json();
            const issues = data.issues;
    
            // Sprawdzenie statusów
            const allDone = issues.every(issue => {
                const status = issue.fields.status.name; 
                return status === 'Done' || status === 'Gotowe';
            });
            
            if (allDone) {
                //console.log('Wszystkie zadania mają status "Done" lub "Gotowe".');
                console.log('Wysyłam raport');
                generateReport();
                sendMails(users);
            } //else {
                //console.log('Nie wszystkie zadania mają status "Done" lub "Gotowe".');
            //}
    
        } catch (error) {
            console.error('Błąd podczas sprawdzania statusów zadań lub wysylania maila z raportem:', error);
        }
    }

    async function sendMails(users) {

        try {

        //console.log('Wysylam maila');

        let emailList = users.map(user => user.email).join(',');
    
        let transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.MAILING_LOGIN,
                pass: process.env.MAILING_PASSWORD
            }
        });
    
        let mailOptions = {
            from: process.env.MAILING_LOGIN,
            to: emailList,
            subject: 'Jira automation report',
            text: 'Report',
            attachments: [
                {
                    filename: 'jira_report.csv', 
                    path: './jira_report.csv' 
                },
                {
                    filename: 'jira_report.json', 
                    path: './jira_report.json'
                }
            ]
        };
            const info = await transporter.sendMail(mailOptions);
            //console.log('Wysłano maila: ' + info.response);
        } catch (error) {
            console.error('Błąd podczas wysyłania maila:', error);
        }

    }

    async function generateReport(){

        const jqlQuery = ''; 
        const fields = 'summary,assignee,status,priority,created,updated'; 
        const maxResults = 100; 
    
        try {
            const response = await fetch(`${jiraURL}/rest/api/3/search?jql=${encodeURIComponent(jqlQuery)}&fields=${fields}&maxResults=${maxResults}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${jiraEmail}:${jiraApiKey}`).toString('base64')}`,
                    'Accept': 'application/json',
                }
        });

            const data = await response.json();

            const issues = data.issues;
            let report = [];
    
            issues.forEach(issue => {
                let reportItem = {
                    summary: issue.fields.summary,
                    assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
                    status: issue.fields.status.name,
                    priority: issue.fields.priority ? issue.fields.priority.name : 'None',
                    created: issue.fields.created,
                    updated: issue.fields.updated
                };
                report.push(reportItem);
            });

            fs.writeFileSync('jira_report.json', JSON.stringify(report, null, 2));
            console.log('Wygenerowano raport i zapisano jako jira_report.json');

            let csv = 'Summary,Assignee,Status,Priority,Created,Updated\n';
            report.forEach(issue => {
                csv += `"${issue.summary}","${issue.assignee}","${issue.status}","${issue.priority}","${issue.created}","${issue.updated}"\n`;
            });
            fs.writeFileSync('jira_report.csv', csv);
            console.log('Wygenerowano raport i zapisano jako jira_report.csv');
    
        } catch (error) {
            console.error('Błąd podczas generowania raportu:', error);
        }
    }

    async function workBalancer(taskId){
        try {
        
            let startAt = 0;
            const maxResults = 1000;
            
            let jqlQuery = 'status != Done'; 

            let response = await fetch(`${jiraURL}/rest/api/3/search?jql=${encodeURIComponent(jqlQuery)}&maxResults=${maxResults}&startAt=${startAt}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json'
                }
            });
    
            let data = await response.json();
            //console.log(data.issues);

            let userTasks = {};

            function getUserTasks(user, tasks) {
                if (userTasks[user]) {
                    userTasks[user] += tasks;
                } 
                else {
                    userTasks[user] = tasks;
                }
            }

            data.issues.forEach(issue => {
                let user = issue.fields.assignee.accountId;
                let tasks = 1;
                getUserTasks(user, tasks);
            });

            //console.log(userTasks);
            
            let sortedUserTasks = Object.fromEntries(
                Object.entries(userTasks).sort(([, a], [, b]) => a - b)
            );
            
            console.log(sortedUserTasks);

            let [user, tasks] = Object.entries(sortedUserTasks)[0];
            //console.log(user);
            //console.log(tasks);

            AssigneTaskWithWorkBalancer(user, taskId);

        } catch (error) {
            console.log(error);
        }
    }

    async function AssigneTaskWithWorkBalancer(user, taskId){
        try {
            let response = await fetch(`${jiraURL}/rest/api/3/issue/${taskId}/assignee`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    accountId: user
                })
            });
        }
        catch(e){
            console.error("Nie udalo sie przypisać zadania");
        }
    }

async function closeSubtask(id) {
    const transitionId = '31'; 

    try {
        const bodyData = JSON.stringify({
            transition: {
                id: transitionId
            }
        });

        let response = await fetch(`${jiraURL}/rest/api/3/issue/${id}/transitions`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(
                    `${jiraEmail}:${jiraApiKey}`
                ).toString('base64')}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: bodyData
        });

        if (response.ok) {
            console.log(`Zadanie o ID: ${id} zostało zamknięte.`);
        } else {
            console.error(`Nie udało się zamknąć zadania o ID: ${id}. Status: ${response.status}`);
        }
    } catch (error) {
        console.error('Błąd podczas zmiany statusu zadania:', error);
    }
}

async function checkTasks() {
    
    try {
        
        let startAt = 0;
        const maxResults = 1000;
        let duplicatedIssues = [];

        let response = await fetch(`${jiraURL}/rest/api/3/search?maxResults=${maxResults}&startAt=${startAt}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${Buffer.from(
                    `${jiraEmail}:${jiraApiKey}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        });

        let data = await response.json();

        //console.log(data);
        let issuesArr = data.issues;
        //console.log(issuesArr);

        issuesArr.forEach(async el=>{

            let issueId = el.id;
            let status = el.fields.status.name;
            let subtasks = el.fields.subtasks;

            if(status == 'Gotowe' && subtasks.length>0){
                //console.log(issueId);

                subtasks.forEach(async el=>{
                    let subtaskId = el.id;
                    let subtaskStatus = el.fields.status.name;
                    //console.log(subtaskId +'' + subtaskStatus);

                    if(subtaskStatus != 'Gotowe'){
                        await closeSubtask(subtaskId);
                    }
                });
            }            
        });
    } catch (error) {
        console.log(error);
    }

}

async function findDuplicates() {
    try {
        let startAt = 0;
        const maxResults = 1000;
        let duplicatedIssues = [];
        let jqlQuery = 'status != Done'; 

        let response = await fetch(`${jiraURL}/rest/api/3/search?jql=${encodeURIComponent(jqlQuery)}&maxResults=${maxResults}&startAt=${startAt}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${Buffer.from(
                    `${jiraEmail}:${jiraApiKey}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        });

        let data = await response.json();
        let issuesArr = await data.issues;
        let compareArr = await data.issues;

        issuesArr.forEach(async (el) => {
            let issueType = el.fields.issuetype ? el.fields.issuetype.name : null;
            let issueSummary = el.fields.summary;
            let issueDescription = el.fields.description && el.fields.description.content 
                && el.fields.description.content[0] 
                && el.fields.description.content[0].content 
                && el.fields.description.content[0].content[0] 
                ? el.fields.description.content[0].content[0].text : '';
            let issuePriority = el.fields.priority ? el.fields.priority.name : null;
            let issueId = el.id;

            compareArr.forEach(async (comparedEl) => {
                let comparedType = comparedEl.fields.issuetype ? comparedEl.fields.issuetype.name : null;
                let comparedSummary = comparedEl.fields.summary;
                let comparedDescription = comparedEl.fields.description && comparedEl.fields.description.content 
                    && comparedEl.fields.description.content[0] 
                    && comparedEl.fields.description.content[0].content 
                    && comparedEl.fields.description.content[0].content[0] 
                    ? comparedEl.fields.description.content[0].content[0].text : '';
                let comparedPriority = comparedEl.fields.priority ? comparedEl.fields.priority.name : null;
                let comparedId = comparedEl.id;

                if (issueId != comparedId && issueType == comparedType && issueSummary == comparedSummary && issueDescription == comparedDescription && issuePriority == comparedPriority) {
                    duplicatedIssues.push(comparedId);
                }
            });
        });

        let elementToRemove = [...new Set(duplicatedIssues)];
        let finalElements = elementToRemove;

        if (finalElements.length > 0) {
            deleteDuplicates(finalElements);
        }

    } catch (error) {
        console.error("Error fetching issues:", error);
    }
}

async function deleteDuplicates(duplicatedIssues) {
    for(let i = 1; i<duplicatedIssues.length; i++) {
        try {
            let response = await fetch(`${jiraURL}/rest/api/3/issue/${duplicatedIssues[i]}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json'
                }
            });
        }
        catch (error) {
            console.error("Nie udało się usunąć duplikatu:", error);
        }
    }
    console.log('Usunięto duplikaty z zestawu elementow: ', duplicatedIssues);
}
async function changePriority(issueId) {
    try {
        const priorityId = '2';
        
        const bodyData = JSON.stringify({
            fields: {
                priority: {
                    id: priorityId
                }
            }
        });

        let response = await fetch(`${jiraURL}/rest/api/3/issue/${issueId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${Buffer.from(
                    `${jiraEmail}:${jiraApiKey}`
                ).toString('base64')}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: bodyData
        });

        console.log('Zmieniono Priorytet zadania na "High"');
    } catch (error) {
        console.error("Nie udało się zmienić priorytetu:", error);
    }
}

async function checkSubtasksUsingParentID(id, subtasks){

    //console.log(subtasks);
    //console.log(typeof Array.from(subtasks));
    
    let issueId = id;
    let arr = Array.from(subtasks);

    if (arr.length == 0) {
        console.log('Nie ma subtasków');
        return;
    }

    let allCompleted = true;

    for (const element of arr) {
        //console.log(element.fields.status.name);
        if (element.fields.status.name != "Gotowe") {
            allCompleted = false;
        }
    }

    if (allCompleted) {
        //console.log('Wszystkie subtaski są gotowe, można zamknąć całe zadanie');
        
        try {
            const transitionId = '31'; // ID dla "Gotowe"
            
            const bodyData = JSON.stringify({
                transition: {
                    id: transitionId
                }
            });

            let response = await fetch(`${jiraURL}/rest/api/3/issue/${issueId}/transitions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: bodyData
            });

            //console.log('Zmieniono status zadania na "Gotowe"');
        } catch (error) {
            console.error("Nie udało się zmienić statusu:", error);
        }
    }
}

async function checkSubtasks(issueId, data) {

    //console.log(data.issue.fields.subtasks);

    if(data.issue.fields.status.name == "Gotowe"){
        console.log('Zadanie juz jest gotowe');
        return;
    }


    let arr = data.issue.fields.subtasks;
    if (arr.length == 0) {
        console.log('Nie ma subtasków');
        return;
    }

    let allCompleted = true;

    for (const element of arr) {
        //console.log(element.fields.status.name);
        if (element.fields.status.name != "Gotowe") {
            allCompleted = false;
            return;
        }
    }

    if (allCompleted == true) {
        //console.log('Wszystkie subtaski są gotowe, można zamknąć całe zadanie');
        try {
            const transitionId = '31'; // ID dla "Gotowe"
            
            const bodyData = JSON.stringify({
                transition: {
                    id: transitionId
                }
            });

            let response = await fetch(`${jiraURL}/rest/api/3/issue/${issueId}/transitions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${jiraEmail}:${jiraApiKey}`
                    ).toString('base64')}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: bodyData
            });

            //console.log('Zmieniono status zadania na "Gotowe"');
        } catch (error) {
            console.error("Nie udało się zmienić statusu:", error);
        }
    }
}

async function assigneTask(type,issueId) {
    
    if(type=="bug"){

        try {
            
            let id = "712020:180dda81-8e80-43ad-aee6-537b38836786"; //gedeon id;
            const bodyData = `{
                "accountId": "${id}"
              }`;

            let response = await fetch(`${jiraURL}/rest/api/3/issue/${issueId}/assignee`, {
                method: 'PUT',
                headers: {
                  'Authorization': `Basic ${Buffer.from(
                    `${jiraEmail}:${jiraApiKey}`
                  ).toString('base64')}`,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json'
                },
                body: bodyData
            });
        } catch (error) {
           console.error("Nie udalo sie przepisać"); 
        }   
    }
}

app.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}`);
});

