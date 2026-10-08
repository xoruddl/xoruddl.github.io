---
layout: post
title: "Ansible (2) - 변수, 반복, 템플릿, 조건, handler로 playbook 다듬기"
date: 2026-09-25 14:15:29 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "yaml", "jinja2"]
---

## 1. 개요

[이전 글](/posts/Ansible-1-Ansible이-하는-일과-첫-playbook-실행하기/)에서는 디렉터리와 파일을 만드는 playbook으로 Ansible의 기본 흐름과 멱등성을 확인했다. 그런데 실제 playbook은 값이 서버마다 다르고, 같은 작업을 여러 번 반복하고, 상황에 따라 작업을 건너뛰어야 한다.

이 글에서는 그때 쓰는 다섯 가지 문법을 하나의 예제로 정리한다.

| 문법 | 하는 일 |
| --- | --- |
| 변수 `{{ }}` | 값을 이름으로 쓰고, 실행할 때 바꾼다 |
| `loop` | 같은 task를 목록의 원소마다 실행한다 |
| `template` | 변수를 채워 넣은 설정 파일을 만든다 |
| `register` + `when` | 이전 task 결과를 보고 다음 task를 실행할지 정한다 |
| `notify` + `handlers` | 무언가 바뀌었을 때만 후속 작업을 실행한다 |

실습은 이전 글의 `ansible-practice` 디렉터리와 inventory(`localhost`)를 그대로 쓴다.

---

## 2. 예제 전체

앱 하나를 배포한다고 가정하고, 앱 디렉터리와 사용자별 파일, 설정 파일을 만드는 playbook이다. 먼저 전체를 보고, 3장부터 한 부분씩 살펴본다.

```text
ansible-practice/
├── ansible.cfg
├── inventory.ini
├── app.yml                 # playbook
└── templates/
    └── app.conf.j2         # 설정 파일 템플릿
```

```yaml
# app.yml
- name: 설정 파일 배포 연습
  hosts: local
  gather_facts: false                      # facts 수집 생략 (이 예제에서는 쓰지 않음)

  vars:                                    # 이 play에서 쓸 변수
    app_dir: /tmp/ansible-practice/app
    app_name: myapp
    app_port: 8080
    users:
      - alice
      - bob

  tasks:
    - name: 앱 디렉터리 만들기
      ansible.builtin.file:
        path: "{{ app_dir }}"
        state: directory
        mode: "0755"

    - name: 사용자별 인사 파일 만들기
      ansible.builtin.copy:
        dest: "{{ app_dir }}/{{ item }}.txt"
        content: "Hello, {{ item }}!\n"
        mode: "0644"
      loop: "{{ users }}"

    - name: 설정 파일 만들기
      ansible.builtin.template:
        src: templates/app.conf.j2
        dest: "{{ app_dir }}/app.conf"
        mode: "0644"
      notify: 설정 변경 알림

    - name: 초기화 표시 파일이 있는지 확인
      ansible.builtin.stat:
        path: "{{ app_dir }}/.initialized"
      register: init_marker

    - name: 처음 한 번만 초기화
      ansible.builtin.command: touch {{ app_dir }}/.initialized
      when: not init_marker.stat.exists

  handlers:
    - name: 설정 변경 알림
      ansible.builtin.debug:
        msg: "설정 파일이 바뀌었다. 실제 서버라면 여기서 서비스를 재시작한다."
```

```text
# templates/app.conf.j2
# {{ app_name }} 설정 파일 (Ansible이 생성함)
name = {{ app_name }}
port = {{ app_port }}
{% for user in users %}
allow_user = {{ user }}
{% endfor %}
```

---

## 3. 변수

### 3.1 정의하고 쓰기

play의 `vars:` 아래에 `이름: 값`으로 변수를 정의한다.

```yaml
  vars:
    app_dir: /tmp/ansible-practice/app
    app_port: 8080
    users:              # list 변수
      - alice
      - bob
```

변수를 쓸 때는 `{{ 변수 }}`로 감싼다. 이 문법은 Python 템플릿 엔진인 **Jinja2**의 문법이다. `"{{ app_dir }}/app.conf"`는 실행할 때 `/tmp/ansible-practice/app/app.conf`로 바뀐다.

값이 `{{`로 시작하면 **반드시 따옴표로 감싼다**. YAML은 `{`를 map의 시작으로 읽기 때문에, 따옴표가 없으면 문법 오류가 난다.

```yaml
path: "{{ app_dir }}"      # O
path: {{ app_dir }}        # X: YAML 문법 오류
```

### 3.2 실행할 때 바꾸기

`-e` 옵션으로 변수를 넘기면 playbook의 값보다 우선한다. playbook을 고치지 않고 값만 바꿔 실행할 때 쓴다.

```bash
ansible-playbook app.yml -e app_port=9090
```

실제 프로젝트에서는 변수를 playbook 밖의 파일에 모아 두는 경우가 많다. `group_vars/그룹이름.yml` 파일을 만들면 그 그룹의 호스트에 자동으로 적용된다. 예를 들어 `group_vars/all.yml`은 모든 호스트에 적용된다.

---

## 4. loop: 같은 작업 반복하기

`loop`에 list를 주면 원소마다 task를 한 번씩 실행한다. 지금 실행 중인 원소는 `item`이라는 변수로 쓴다.

```yaml
    - name: 사용자별 인사 파일 만들기
      ansible.builtin.copy:
        dest: "{{ app_dir }}/{{ item }}.txt"    # alice.txt, bob.txt
        content: "Hello, {{ item }}!\n"
        mode: "0644"
      loop: "{{ users }}"                       # ["alice", "bob"]
```

`loop`는 모듈 이름(`ansible.builtin.copy`)과 같은 들여쓰기에 적는다. 모듈 인자가 아니라 task 자체의 설정이기 때문이다. 실행 결과에도 원소마다 한 줄씩 나온다.

```text
TASK [사용자별 인사 파일 만들기] ***********************************************
changed: [localhost] => (item=alice)
changed: [localhost] => (item=bob)
```

---

## 5. template: 설정 파일 만들기

`copy` 모듈의 `content`로도 파일을 만들 수 있지만, 설정 파일처럼 길고 값이 여러 군데 들어가는 파일은 **템플릿 파일**로 따로 둔다. 템플릿 파일은 보통 `.j2` 확장자를 붙이고 `templates/` 디렉터리에 둔다.

```text
# templates/app.conf.j2
# {{ app_name }} 설정 파일 (Ansible이 생성함)
name = {{ app_name }}
port = {{ app_port }}
{% for user in users %}
allow_user = {{ user }}
{% endfor %}
```

템플릿 파일에서는 두 가지 문법을 쓴다.

| 문법 | 뜻 |
| --- | --- |
| `{{ 값 }}` | 값을 그 자리에 넣는다 |
| `{% for %} ... {% endfor %}` | 반복한다. `{% if %} ... {% endif %}`로 조건도 쓸 수 있다 |

`template` 모듈이 변수를 채워서 대상 경로에 파일을 만든다.

```yaml
    - name: 설정 파일 만들기
      ansible.builtin.template:
        src: templates/app.conf.j2       # 제어 노드의 템플릿
        dest: "{{ app_dir }}/app.conf"   # 대상 서버에 만들 파일
        mode: "0644"
```

만들어진 파일은 다음과 같다.

```ini
# myapp 설정 파일 (Ansible이 생성함)
name = myapp
port = 8080
allow_user = alice
allow_user = bob
```

`{% for %}`와 `{% endfor %}`가 있던 줄은 결과에서 사라진다. 템플릿이 바뀌지 않고 변수도 같으면 결과 파일도 같으므로, 다시 실행해도 `ok`로 끝난다.

---

## 6. register와 when: 확인하고 건너뛰기

"처음 한 번만 실행해야 하는 작업"이 있다고 해 보자. 초기화 작업을 한 뒤 표시 파일(`.initialized`)을 남겨 두고, 다음 실행부터는 그 파일이 있으면 건너뛰게 만든다.

```yaml
    - name: 초기화 표시 파일이 있는지 확인
      ansible.builtin.stat:                        # 파일 정보를 조회하는 모듈 (바꾸지 않음)
        path: "{{ app_dir }}/.initialized"
      register: init_marker                        # 결과를 init_marker 변수에 저장

    - name: 처음 한 번만 초기화
      ansible.builtin.command: touch {{ app_dir }}/.initialized
      when: not init_marker.stat.exists            # 파일이 없을 때만 실행
```

- `register: 변수`: task의 실행 결과를 변수에 저장한다. `stat` 모듈의 결과에는 `stat.exists`(파일이 있는지) 같은 값이 들어 있다.
- `when: 조건`: 조건이 참일 때만 task를 실행하고, 거짓이면 `skipping`으로 건너뛴다.

`when`에는 `{{ }}`를 쓰지 않는다. `when`의 값은 처음부터 Jinja2 표현식으로 해석되기 때문이다.

이 패턴이 필요한 이유는 `command` 모듈에 있다. `file`, `copy` 같은 모듈은 원하는 상태를 스스로 확인하지만, `command`는 명령이 무슨 일을 하는지 모른다. 그래서 매번 실행하고 항상 `changed`로 보고한다. 멱등하게 만들려면 이렇게 직접 확인하고 건너뛰어야 한다.

`command`로 실행한 명령의 출력도 `register`로 받을 수 있다. 이때는 `결과.stdout`(표준 출력), `결과.rc`(종료 코드) 같은 값을 쓴다.

---

## 7. notify와 handlers: 바뀌었을 때만 실행하기

설정 파일을 고쳤다면 서비스를 재시작해야 한다. 하지만 설정이 그대로인데 매번 재시작하면 불필요하게 서비스가 끊긴다. 이럴 때 **handler**를 쓴다.

```yaml
    - name: 설정 파일 만들기
      ansible.builtin.template:
        src: templates/app.conf.j2
        dest: "{{ app_dir }}/app.conf"
      notify: 설정 변경 알림             # 이 task가 changed일 때만 handler 호출

  handlers:                             # tasks와 같은 높이에 적는다
    - name: 설정 변경 알림               # notify의 이름과 정확히 같아야 함
      ansible.builtin.debug:
        msg: "설정 파일이 바뀌었다. 실제 서버라면 여기서 서비스를 재시작한다."
```

handler는 다음 규칙으로 동작한다.

- `notify`를 단 task가 `changed`일 때만 호출된다. `ok`이면 호출되지 않는다.
- 호출된 handler는 바로 실행되지 않고, play의 task가 **모두 끝난 뒤** 실행된다.
- 여러 task가 같은 handler를 호출해도 **한 번만** 실행된다.

이 예제에서는 서비스가 없어서 `debug` 모듈로 메시지만 출력한다. 실제 서버라면 `ansible.builtin.systemd_service` 모듈에 `state: restarted`를 적어 서비스를 재시작한다.

---

## 8. 실행 결과 읽기

### 8.1 첫 실행

```bash
ansible-playbook app.yml
```

```text
TASK [앱 디렉터리 만들기] ******************************************************
changed: [localhost]

TASK [사용자별 인사 파일 만들기] ***********************************************
changed: [localhost] => (item=alice)
changed: [localhost] => (item=bob)

TASK [설정 파일 만들기] ********************************************************
changed: [localhost]

TASK [초기화 표시 파일이 있는지 확인] ******************************************
ok: [localhost]

TASK [처음 한 번만 초기화] *****************************************************
changed: [localhost]

RUNNING HANDLER [설정 변경 알림] ***********************************************
ok: [localhost] => {
    "msg": "설정 파일이 바뀌었다. 실제 서버라면 여기서 서비스를 재시작한다."
}

PLAY RECAP *********************************************************************
localhost                  : ok=6    changed=4    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
```

모든 것이 새로 만들어졌다. 설정 파일이 `changed`라서 handler가 마지막에 실행됐다.

### 8.2 두 번째 실행

```text
TASK [설정 파일 만들기] ********************************************************
ok: [localhost]

TASK [초기화 표시 파일이 있는지 확인] ******************************************
ok: [localhost]

TASK [처음 한 번만 초기화] *****************************************************
skipping: [localhost]

PLAY RECAP *********************************************************************
localhost                  : ok=4    changed=0    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
```

- 설정 파일이 그대로라서 `ok`이고, handler는 실행되지 않았다.
- 표시 파일이 이미 있어서 초기화 task는 `skipping`으로 건너뛰었다.
- `changed=0`이다. 두 번 실행해도 결과가 같다.

### 8.3 변수를 바꿔 실행

포트만 바꿔서 실행한다.

```bash
ansible-playbook app.yml -e app_port=9090 --diff
```

```text
TASK [설정 파일 만들기] ********************************************************
@@ -1,5 +1,5 @@
 # myapp 설정 파일 (Ansible이 생성함)
 name = myapp
-port = 8080
+port = 9090
 allow_user = alice
 allow_user = bob

changed: [localhost]

TASK [처음 한 번만 초기화] *****************************************************
skipping: [localhost]

RUNNING HANDLER [설정 변경 알림] ***********************************************
ok: [localhost] => {
    "msg": "설정 파일이 바뀌었다. 실제 서버라면 여기서 서비스를 재시작한다."
}

PLAY RECAP *********************************************************************
localhost                  : ok=5    changed=1    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
```

설정 파일만 바뀌었고, 그래서 handler가 다시 실행됐다. 나머지 task는 모두 그대로다.

---

## 9. 실행 전에 확인하는 명령

playbook이 길어지면 실행하기 전에 확인하는 습관이 도움이 된다.

| 명령 | 하는 일 |
| --- | --- |
| `ansible-playbook app.yml --syntax-check` | YAML과 playbook 문법만 검사한다 |
| `ansible-playbook app.yml --list-tasks` | 실행될 task 목록만 출력한다 |
| `ansible-playbook app.yml --check --diff` | 실제로 바꾸지 않고 무엇이 바뀔지만 보여 준다 |
| `ansible-doc ansible.builtin.template` | 모듈 설명과 인자 목록을 보여 준다 |

`--list-tasks`의 출력은 다음과 같다.

```text
playbook: app.yml

  play #1 (local): 설정 파일 배포 연습	TAGS: []
    tasks:
      앱 디렉터리 만들기	TAGS: []
      사용자별 인사 파일 만들기	TAGS: []
      설정 파일 만들기	TAGS: []
      초기화 표시 파일이 있는지 확인	TAGS: []
      처음 한 번만 초기화	TAGS: []
```

`--check`는 모듈이 "바꾸면 어떻게 될지"를 계산할 수 있을 때만 정확하다. `command` 모듈은 명령을 실제로 실행해 보지 않으면 결과를 알 수 없어서, check 모드에서는 건너뛴다.

---

## 10. 정리

변수는 `vars:`에 정의하고 `{{ }}`로 쓴다. 값이 `{{`로 시작하면 따옴표로 감싸고, 실행할 때 `-e`로 바꿀 수 있다. `loop`는 같은 task를 원소마다 실행하고, `template`은 `.j2` 파일에 변수를 채워 설정 파일을 만든다.

`register`로 결과를 저장하고 `when`으로 실행 여부를 정하면, 원하는 상태를 스스로 확인하지 못하는 `command` 같은 모듈도 멱등하게 만들 수 있다. `notify`와 handler는 설정이 실제로 바뀌었을 때만 재시작 같은 후속 작업을 실행한다.

이 다섯 가지를 조합하면 playbook을 여러 번 실행해도 필요한 것만 바뀌고, 결과 요약의 `changed` 수로 실제로 바뀐 것을 확인할 수 있다.

다음 글에서는 `localhost`를 벗어나 SSH로 실제 서버에 연결하고, ad-hoc 명령으로 패키지를 설치해 본다.
