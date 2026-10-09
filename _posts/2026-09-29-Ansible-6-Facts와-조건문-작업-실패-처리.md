---
layout: post
title: "Ansible (6) - Facts와 조건문, 작업 실패 처리"
date: 2026-09-29 09:17:07 +0900
categories: ["Ansible"]
tags: ["ansible", "iac", "yaml"]
---

## 1. 개요

관리하는 서버가 늘어나면 운영체제 종류나 버전이 서로 다를 수 있다. 같은 playbook을 쓰되 "Ubuntu면 이 작업, 아니면 건너뛰기"처럼 서버 상태에 따라 다르게 동작해야 한다. 또 한 작업이 실패했을 때 전체를 멈출지, 무시하고 계속할지도 정해야 한다.

이 글에서는 Ansible이 서버에서 자동으로 모으는 정보인 **facts**를 살펴보고, 이를 `when` 조건문과 `loop`에 활용한다. 마지막으로 작업이 실패했을 때 흐름을 제어하는 `ignore_errors`와 `force_handlers`를 정리한다.

실습은 Ansible이 설치된 제어 노드에서 진행한다. 관리 대상은 Ubuntu 서버 두 대로, `web1`은 `192.168.0.11`, `web2`는 `192.168.0.12`다. 두 서버에는 SSH 서버와 Python이 있고, SSH 키로 접속할 수 있는 `ansible` 계정이 준비돼 있다고 가정한다.

제어 노드의 `ansible-server` 디렉터리에서 실행한다. `inventory.ini`의 `[web]` 그룹에 두 서버를 등록하고, `ansible.cfg`에서 `inventory = ./inventory.ini`, `remote_user = ansible`을 설정한다. 환경 준비 과정은 [Ansible (3)](/posts/Ansible-3-SSH로-실제-서버에-연결하고-ad-hoc-명령-실행하기/)에 있다.

---

## 2. Facts

### 2.1 Facts란

playbook을 실행하면 처음에 `TASK [Gathering Facts]`가 나온다. 이 단계에서 Ansible은 관리 노드의 호스트 이름, 운영체제, 커널 버전, IP 주소, CPU 개수 같은 정보를 모아 `ansible_facts` 변수에 넣는다. 이 정보를 **facts**라고 한다.

전체 facts는 `debug` 모듈에 `var: ansible_facts`를 주는 task로 출력할 수 있다. 다만 출력이 수백 줄이라, 필요한 항목만 보려면 `setup` 모듈에 `filter`를 주는 ad-hoc 명령이 편하다.

```bash
ansible web1 -m setup -a "filter=ansible_distribution*"
```

```text
web1 | SUCCESS => {
    "ansible_facts": {
        "ansible_distribution": "Ubuntu",
        "ansible_distribution_major_version": "24",
        "ansible_distribution_release": "noble",
        "ansible_distribution_version": "24.04",
        ...
    },
    "changed": false
}
```

### 2.2 자주 쓰는 facts

| facts | 뜻 | 예 |
| --- | --- | --- |
| `ansible_facts['hostname']` | 호스트 이름 | `web1` |
| `ansible_facts['fqdn']` | 전체 도메인 이름 | `web1.example.com` |
| `ansible_facts['distribution']` | 배포판 | `Ubuntu` |
| `ansible_facts['distribution_version']` | 배포판 버전 | `24.04` |
| `ansible_facts['distribution_release']` | 배포판 코드명 | `noble` |
| `ansible_facts['kernel']` | 커널 버전 | `6.8.0-45-generic` |
| `ansible_facts['default_ipv4']['address']` | 기본 IPv4 주소 | `192.168.0.11` |
| `ansible_facts['processor_vcpus']` | CPU 개수 | `2` |
| `ansible_facts['mounts']` | 마운트된 디스크 목록 | list |

`ansible_facts['distribution']`은 `ansible_facts.distribution`처럼 점으로 써도 된다. 예전 자료에서는 `ansible_distribution`처럼 앞에 `ansible_`을 붙인 이름을 쓰기도 하는데 같은 값이다.

### 2.3 facts 사용하기

facts도 변수이므로 `{{ }}`로 쓴다.

```yaml
# print-ip.yml
- name: 기본 IP 출력
  hosts: web
  tasks:
    - name: IP 출력
      ansible.builtin.debug:
        msg: >
          The default IPv4 address of {{ ansible_facts['fqdn'] }}
          is {{ ansible_facts['default_ipv4']['address'] }}
```

`msg: >`는 YAML에서 여러 줄을 공백 하나로 이어 붙여 한 줄로 만드는 문법이다. 실행하면 `web1`에서는 `The default IPv4 address of web1 is 192.168.0.11`이 출력된다.

facts가 필요 없는 playbook이라면 play에 `gather_facts: false`를 적어 수집 단계를 건너뛸 수 있다. 서버가 많을 때 실행 시간이 줄어든다.

---

## 3. when: 조건에 맞을 때만 실행하기

### 3.1 기본 사용법

`when`에 적은 조건이 참일 때만 task를 실행하고, 거짓이면 `skipping`으로 건너뛴다. 예를 들어 play 변수 `run_my_task: true`를 두고 task에 `when: run_my_task`를 붙이면, `-e run_my_task=false`로 실행했을 때만 그 task를 건너뛴다.

### 3.2 facts로 운영체제 구분하기

facts와 함께 쓰면 운영체제에 따라 다른 작업을 할 수 있다.

```yaml
- name: 운영체제 확인
  hosts: web
  vars:
    supported_distros:
      - RedHat
      - CentOS
  tasks:
    - name: dnf를 쓰는 배포판이면 출력
      ansible.builtin.debug:
        msg: "This {{ ansible_facts['distribution'] }} need to use dnf"
      when: ansible_facts['distribution'] in supported_distros
```

`web1`, `web2`는 Ubuntu라서 이 task는 `skipping`이 된다. `in`은 값이 목록 안에 있는지 확인한다.

### 3.3 여러 조건

`when`에 목록을 주면 모든 조건이 참이어야 실행한다(`and`). 버전 값은 실습 서버에 맞게 바꾼다.

```yaml
    - name: Ubuntu 24.04에서만 실행
      ansible.builtin.debug:
        msg: "{{ ansible_facts['distribution'] }} {{ ansible_facts['distribution_version'] }}"
      when:
        - ansible_facts['distribution'] == "Ubuntu"
        - ansible_facts['distribution_version'] == "24.04"
```

둘 중 하나만 참이어도 되게 하려면 `when: ansible_facts['distribution'] == "Ubuntu" or ansible_facts['distribution'] == "Debian"`처럼 `or`로 잇는다.

### 3.4 loop와 when 함께 쓰기

`loop`와 `when`을 함께 쓰면 `when`은 원소마다 따로 평가된다. 마운트된 디스크 중 `/`만 골라 남은 용량을 출력한다.

```yaml
    - name: 루트 디렉터리 남은 용량 출력
      ansible.builtin.debug:
        msg: "Directory {{ item['mount'] }} size is {{ item['size_available'] }}"
      loop: "{{ ansible_facts['mounts'] }}"
      when: item['mount'] == "/"
```

`/`가 아닌 원소는 `skipping`으로 표시되고, `/`인 원소만 메시지가 나온다. `size_available`의 단위는 바이트다.

---

## 4. 이전 작업의 결과로 분기하기

`register`로 저장한 결과도 `when`에 쓸 수 있다.

```yaml
- name: rsyslog 상태 확인
  hosts: web
  tasks:
    - name: rsyslog 상태 조회
      ansible.builtin.command: systemctl is-active rsyslog
      register: result
      changed_when: false          # 조회만 하므로 changed로 표시하지 않음
      failed_when: false           # 실행 중이 아니어도 실패로 보지 않음

    - name: 실행 중이면 출력
      ansible.builtin.debug:
        msg: "Rsyslog status is {{ result.stdout }}"
      when: result.stdout == "active"
```

`systemctl is-active`는 서비스가 멈춰 있으면 0이 아닌 종료 코드를 돌려준다. Ansible은 이를 실패로 보기 때문에, 여기서는 `failed_when: false`로 실패 판단을 끄고 `stdout` 값으로 직접 분기했다.

---

## 5. 작업이 실패했을 때

### 5.1 기본 동작

Ansible은 각 task의 종료 코드를 보고 성공 여부를 판단한다. 어떤 호스트에서 task가 실패하면 **그 호스트의 나머지 task는 모두 건너뛴다.** 다른 호스트는 계속 진행한다.

### 5.2 ignore_errors: 실패해도 계속하기

실패해도 괜찮은 task에는 `ignore_errors: true`를 붙인다. 없는 패키지를 설치하는 예다.

```yaml
- name: 실패 무시
  hosts: web
  become: true
  tasks:
    - name: 없는 패키지 설치
      ansible.builtin.apt:
        name: no-such-package
        state: present
      ignore_errors: true

    - name: 다음 작업
      ansible.builtin.debug:
        msg: "Before task is error"
```

```text
TASK [없는 패키지 설치] ********************************************************
fatal: [web1]: FAILED! => {"changed": false, "msg": "No package matching 'no-such-package' is available"}
...ignoring
```

실패 뒤에도 `다음 작업` task가 실행되어 메시지가 출력된다. 결과 요약에는 `ignored=1`로 집계된다.

### 5.3 force_handlers: 실패해도 handler 실행하기

handler는 play의 task가 모두 끝난 뒤 실행된다. 그래서 중간에 task가 실패하면, 앞에서 `notify`로 호출해 둔 handler도 실행되지 않는다. 설정은 바뀌었는데 재시작은 안 된 상태로 남을 수 있다.

play에 `force_handlers: true`를 적으면 실패로 멈추더라도 이미 호출된 handler는 실행한다.

```yaml
- name: 실패해도 handler 실행
  hosts: web
  become: true
  force_handlers: true
  tasks:
    - name: rsyslog 재시작
      ansible.builtin.service:
        name: rsyslog
        state: restarted
      notify: 재시작 알림

    - name: 없는 패키지 설치
      ansible.builtin.apt:
        name: no-such-package
        state: present

  handlers:
    - name: 재시작 알림
      ansible.builtin.debug:
        msg: "rsyslog is restarted"
```

두 번째 task가 실패했지만 `RUNNING HANDLER [재시작 알림]`이 실행된다. `force_handlers`를 지우고 실행하면 handler는 실행되지 않는다.

### 5.4 실패와 변경 판단 바꾸기

| 키워드 | 하는 일 |
| --- | --- |
| `ignore_errors: true` | 실패해도 다음 task를 계속 실행한다 |
| `failed_when: 조건` | 조건이 참일 때를 실패로 본다. `false`면 절대 실패하지 않는다 |
| `changed_when: 조건` | 조건이 참일 때만 `changed`로 표시한다 |
| `force_handlers: true` | play가 실패로 멈춰도 호출된 handler를 실행한다 |

---

## 6. 정리

facts는 Ansible이 play 시작 때 관리 노드에서 모으는 정보로, `ansible_facts['distribution']`처럼 변수로 쓴다. 필요한 항목은 `setup` 모듈의 `filter`로 찾는다.

`when`은 조건이 참일 때만 task를 실행한다. facts와 함께 쓰면 운영체제별로 다른 작업을 하나의 playbook에 담을 수 있고, `loop`와 함께 쓰면 원소마다 조건을 따진다. `register` 결과로 다음 task를 분기할 수도 있다.

task가 실패하면 그 호스트의 나머지 task는 건너뛴다. `ignore_errors`로 실패를 무시하고, `force_handlers`로 이미 호출된 handler를 실행하며, `failed_when`과 `changed_when`으로 판단 기준을 직접 정할 수 있다.
