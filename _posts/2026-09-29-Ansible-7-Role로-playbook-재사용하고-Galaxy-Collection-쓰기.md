---
layout: post
title: "Ansible (7) - Role로 playbook 재사용하고 Galaxy, Collection 쓰기"
date: 2026-09-29 09:17:08 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "role", "ansible-galaxy"]
---

## 1. 개요

playbook이 커지면 한 파일에 task, 변수, handler, 설정 파일이 모두 섞인다. 웹 서버 설치 작업을 다른 프로젝트에서도 쓰고 싶다면 필요한 부분을 골라 복사해야 한다.

**role**은 "웹 서버 설치"처럼 한 가지 역할에 필요한 task, 변수, 파일, handler를 정해진 디렉터리 구조로 묶은 것이다. playbook에서는 role 이름만 부르면 된다. 이 글에서는 Apache 웹 서버를 설치하는 role을 직접 만들고, 다른 사람이 만든 role을 **Ansible Galaxy**에서 받아 쓰는 방법과 **collection**의 개념을 정리한다.

실습에는 Ansible이 설치된 제어 노드와 SSH로 접속할 수 있는 Ubuntu 또는 Debian 관리 노드가 필요하다. 관리 노드에는 Python과 `sudo` 권한이 있는 `ansible` 계정이 준비돼 있다고 가정한다. 아래 예시 IP 주소 `192.168.0.11`은 자신의 서버 주소로 바꾼다. Apache가 사용할 80번 포트도 비어 있어야 한다. Nginx 등 다른 웹 서버가 실행 중이라면 먼저 중지한다.

제어 노드에서 작업 디렉터리 `ansible-server`를 만들고, 그 안에 서버 목록과 Ansible 설정을 준비한다. `inventory.ini`의 `[web]`은 뒤의 playbook에서 `hosts: web`으로 지정할 서버 그룹이다.

```bash
mkdir -p ansible-server
cd ansible-server
```

```ini
# inventory.ini
[web]
web1 ansible_host=192.168.0.11
```

```ini
# ansible.cfg
[defaults]
inventory = ./inventory.ini
remote_user = ansible
```

SSH 키 접속과 관리자 권한이 준비됐는지 확인한 뒤 실습을 시작한다. 접속 계정이나 인증 방식이 다르면 `ansible.cfg`와 inventory를 자신의 환경에 맞게 바꾼다.

```bash
ansible web -m ansible.builtin.ping
ansible web -b -m ansible.builtin.command -a 'whoami'
```

첫 명령은 각 서버에서 `pong`, 둘째 명령은 `root`가 출력되면 된다. SSH 키와 서버 준비 과정이 필요하다면 [Ansible (3)](/posts/Ansible-3-SSH로-실제-서버에-연결하고-ad-hoc-명령-실행하기/)을 참고한다.

---

## 2. role을 쓰는 이유

- 작업을 역할 단위로 묶어서 다른 playbook이나 다른 사람과 쉽게 공유한다.
- 웹 서버, DB 서버처럼 시스템 종류별로 필요한 요소를 한곳에 정의한다.
- 큰 프로젝트를 role 단위로 나눠 관리하고, 여러 사람이 role을 나눠 동시에 개발할 수 있다.
- 잘 만든 role은 Ansible Galaxy에 올려 공유하고, 다른 사람의 role을 가져와 쓸 수도 있다.

---

## 3. role 디렉터리 구조

`ansible-galaxy role init`으로 role의 기본 구조를 만든다. playbook 옆의 `roles/` 디렉터리에 두면 Ansible이 자동으로 찾는다.

```bash
ansible-galaxy role init --init-path roles apache
```

```text
roles/apache/
├── README.md
├── defaults/main.yml     # 기본 변수 (우선순위 가장 낮음)
├── files/                # 그대로 복사할 정적 파일
├── handlers/main.yml     # handler
├── meta/main.yml         # 작성자, 지원 플랫폼, 의존 role 등
├── tasks/main.yml        # 실행할 task
├── templates/            # Jinja2 템플릿 (.j2)
├── tests/                # 테스트용 inventory와 test.yml
└── vars/main.yml         # role 내부 변수 (우선순위 높음)
```

최상위 디렉터리 이름(`apache`)이 role 이름이다. 모든 디렉터리를 채울 필요는 없고, 쓰지 않는 디렉터리는 지워도 된다. 명령 옵션은 `ansible-galaxy role -h`로 확인한다.

`defaults`와 `vars`는 둘 다 변수를 두는 곳이지만 역할이 다르다.

| 디렉터리 | 우선순위 | 용도 |
| --- | --- | --- |
| `defaults/` | 가장 낮음 | role을 쓰는 사람이 바꿔도 되는 값. inventory나 play 변수로 덮어쓸 수 있다 |
| `vars/` | 높음 | role 내부에서 고정해 쓰는 값. play 변수로는 덮어쓸 수 없고 `-e` 정도만 이긴다 |

---

## 4. Apache 설치 role 만들기

### 4.1 tasks

role이 실행할 task를 `tasks/main.yml`에 적는다. play의 `tasks:` 아래 목록 부분만 옮겨 적는다고 생각하면 된다.

```yaml
# roles/apache/tasks/main.yml
- name: "{{ service_title }} 설치"
  ansible.builtin.apt:
    name: "{{ service_name }}"
    state: present
    update_cache: true
  become: true
  when: ansible_facts['distribution'] in supported_distros

- name: 첫 화면 파일 복사
  ansible.builtin.copy:
    src: index.html
    dest: "{{ dest_file_path }}"
  become: true
  notify: 서비스 재시작
```

`copy`의 `src: index.html`은 role 안의 `files/` 디렉터리에서 찾는다. 그래서 `../files/index.html`처럼 경로를 적지 않아도 된다. Ansible은 실행 전에 관리 노드의 운영체제 같은 정보인 **facts**를 수집한다. `when`은 그중 배포판 이름인 `ansible_facts['distribution']`이 `supported_distros` 목록에 있을 때만 설치 task를 실행한다. 여기서는 Ubuntu와 Debian만 허용한다. 

### 4.2 files, handlers

웹에서 보여 줄 파일과, 파일이 바뀌었을 때 서비스를 다시 시작할 handler를 만든다. `notify: 서비스 재시작`은 같은 이름의 handler를 호출한다.

```text
# roles/apache/files/index.html
Hello! Ansible
```

```yaml
# roles/apache/handlers/main.yml
- name: 서비스 재시작
  ansible.builtin.service:
    name: "{{ service_name }}"
    state: restarted
  become: true
```

### 4.3 defaults, vars

task와 handler에서 참조하는 변수를 각각의 파일에 정의한다.

```yaml
# roles/apache/defaults/main.yml
service_title: "Apache Web Server"
```

```yaml
# roles/apache/vars/main.yml
service_name: apache2
dest_file_path: /var/www/html/index.html
supported_distros:
  - Ubuntu
  - Debian
```

화면에 보이는 이름인 `service_title`은 쓰는 사람이 바꿔도 되니 `defaults`에, 패키지 이름이나 경로처럼 role이 동작하는 데 필요한 값은 `vars`에 두었다.

---

## 5. playbook에서 role 쓰기

작업 디렉터리에 다음 playbook을 만든다. 앞에서 만든 `roles/apache/`를 `import_role`로 실행한다.

```yaml
# role-example.yml
- name: role로 Apache 설치
  hosts: web
  tasks:
    - name: 시작 메시지
      ansible.builtin.debug:
        msg: "Lets start role play"

    - name: apache role 실행
      ansible.builtin.import_role:
        name: apache
```

```bash
ansible-playbook role-example.yml
curl http://192.168.0.11
# Hello! Ansible
```

playbook이 끝난 뒤 `curl` 응답으로 `files/index.html`이 배포됐는지 확인한다. 서버 주소는 inventory에 적은 주소를 사용한다.

`import_role`은 task 목록 중간에 role을 넣는다. 다른 task 없이 role만 실행한다면 play에 `roles:` 키워드를 쓰는 방법이 더 간단하다.

```yaml
- name: role로 Apache 설치
  hosts: web
  roles:
    - apache
```

`defaults`의 값은 play에서 덮어쓸 수 있다. `roles:` 아래에 `- role: apache`와 함께 `service_title: "My Web"`을 적거나, `-e service_title="My Web"`으로 실행하면 첫 task 이름이 바뀐다.

role 안의 task를 조건에 따라 실행 중에 불러와야 한다면 `include_role`을 쓴다. `import_role`은 playbook을 읽을 때 미리 펼쳐지고, `include_role`은 실행 중 그 task에 도달했을 때 불러온다.

---

## 6. Ansible Galaxy

[Ansible Galaxy](https://galaxy.ansible.com)는 role과 collection을 공유하는 사이트다. PostgreSQL을 설치하는 role을 찾아 받아 본다.

```bash
ansible-galaxy role search postgresql --platforms Ubuntu

ansible-galaxy role info buluma.postgres

# 현재 디렉터리의 roles/ 아래에 설치
ansible-galaxy role install -p roles buluma.postgres

ansible-galaxy role list -p roles

# 삭제
ansible-galaxy role remove -p roles buluma.postgres
```

role 이름은 `작성자.role이름` 형식이다. 설치한 role은 직접 만든 role과 똑같이 `roles:`나 `import_role`로 쓴다.

Galaxy는 올라온 role의 내용을 검증하지 않는다. 누구나 올릴 수 있으므로 쓰기 전에 소스 저장소, 최근 업데이트 날짜, 다운로드 수, 관리 노드에서 실제로 무엇을 실행하는지 확인한다. role은 대개 관리자 권한으로 실행되기 때문에 더 조심해야 한다.

---

## 7. Collection

### 7.1 왜 생겼나

초기 Ansible은 모듈을 본체와 함께 배포했다. 모듈을 고치려면 본체도 새 버전으로 배포해야 하고 이름도 겹치지 않게 관리해야 했다. **collection**은 모듈, 플러그인, role을 묶어 본체와 따로 배포하는 단위다. Ansible 본체(`ansible-core`)와 collection을 각각 업데이트할 수 있다.

### 7.2 모듈 이름과 collection

지금까지 쓴 `ansible.builtin.copy`는 `네임스페이스.컬렉션.모듈` 형식의 **FQCN**(Fully Qualified Collection Name)이다. `ansible.builtin`은 `ansible-core`에 기본으로 들어 있는 collection이다.

```bash
# collection 관련 명령 확인
ansible-galaxy collection -h

# 설치된 collection 목록
ansible-galaxy collection list

# collection 설치
ansible-galaxy collection install community.docker
```

`pip`이나 `apt`로 `ansible` 패키지를 설치했다면 자주 쓰는 collection이 이미 함께 들어 있다. `ansible-core`만 설치했거나 더 새 버전이 필요하면 `collection install`로 받는다.

---

## 8. 정리

role은 한 역할에 필요한 task, 변수, 파일, handler를 정해진 디렉터리에 나눠 담은 묶음이다. `ansible-galaxy role init`으로 구조를 만들고, `tasks/main.yml`에서 시작한다. 바꿔도 되는 값은 `defaults`에, 고정 값은 `vars`에 두며, `files`와 `templates`의 파일은 경로 없이 이름만으로 쓴다.

playbook에서는 `roles:`나 `import_role`로 role을 부른다. Ansible Galaxy에서 다른 사람의 role을 받아 쓸 수 있지만 검증된 코드가 아니므로 내용을 확인하고 써야 한다. 모듈은 collection 단위로 본체와 따로 배포되며, `ansible.builtin.copy` 같은 FQCN으로 어느 collection의 모듈인지 드러난다.
