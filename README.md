# Optom Roster Automation

## Getting Start

### Get node_modules
```shell
# npm
npm install
# yarn
yarn install
```

### Run Dev Server
```shell
# npm
npm run dev
# yarn
yarn dev
```

## API Document
### Roster 
#### 1. getList <br/>
endpoint :
```
/api/roster/getList?from=<"YYYY-MM-DD">&to=<"YYYY-MM-DD">
```
response :
```
| Key           | Type          | Description                  |
|---------------|---------------|------------------------------|
| id            | String        | Roster id                    |
| employeeId    | Number        | Employee id                  |
| employeeName  | String        | Employee name                |
| locationId    | Number        | Location id                  |
| locationName  | String        | Location name                |
| breaks        | Array<Object> | Breaks Object                |
| startTime     | String        | roster start time (ISO 8601) |
| endTime       | String        | roster end time (ISO 8601)   |

breaks
| Key           | Type          | Description                  |
|---------------|---------------|------------------------------|
| id            | String        | Roster id                    |
| startTime     | Number        | Employee id                  |
| endTime       | String        | Employee name                |
| isPaidBreak   | Number        | Location id                  |
```
2. counter
endpoint :
```
/api/roster/counter?store=<string>&date=<"YYYY-MM-DD">
```
response:
```
| Key           | Type          | Description                  |
|---------------|---------------|------------------------------|
| store         | String        | Search Store                 |
| count         | Number        | Optom's count                |

```
3. refresh
endpoint :
```
/api/roster/refresh
```
response
```
----- NONE -----
```