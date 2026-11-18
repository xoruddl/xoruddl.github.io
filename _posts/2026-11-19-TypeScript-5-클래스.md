---
layout: post
title: "TypeScript (5) - 클래스"
date: 2026-11-19 00:30:59 +0900
categories: ["TypeScript"]
tags: ["typescript", "타입스크립트", "클래스", "접근 제어자", "readonly", "static", "추상 클래스"]
---

## 클래스에 타입 붙이기

JavaScript의 클래스는 객체를 찍어내는 틀이다. TypeScript는 여기에 타입 검사를 더해, 클래스가 어떤 속성을 가지는지, 그 속성을 어디서 읽고 바꿀 수 있는지를 컴파일 단계에서 확인해 준다.

## 속성은 먼저 선언해야 한다

JavaScript에서는 생성자에서 `this.color = color`만 써도 속성이 생긴다. 같은 코드를 TypeScript에서 쓰면 에러가 난다.

```ts
class Car {
    constructor(color: string) {
        this.color = color; // Property 'color' does not exist on type 'Car'.
    }
}
```

TypeScript는 클래스가 가질 속성을 미리 알아야 하기 때문이다. 그래서 클래스 본문에 속성 이름과 타입을 먼저 적는다. 이를 **멤버 변수**(필드) 선언이라고 한다.

```ts
class Car {
    color: string;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
    }
}

const bmw = new Car("red");
```

`color: string`을 선언했으므로 이제 `this.color`에 값을 넣을 수 있고, `bmw.color`의 타입도 `string`으로 잡힌다.

## 생성자 매개변수로 속성 선언하기

속성 선언과 생성자 대입을 매번 따로 쓰는 것은 번거롭다. 생성자 매개변수 앞에 `public`이나 `readonly`를 붙이면 선언과 대입을 한 번에 처리할 수 있다. 이를 **매개변수 속성**(parameter property)이라고 한다.

```ts
class Car {
    constructor(readonly color: string) {}
    start() {
        console.log("start");
    }
}

const bmw = new Car("red");
console.log(bmw.color); // "red"
```

`readonly color: string` 한 줄이 "`color` 속성을 선언하고, 생성자로 받은 값을 넣는다"는 뜻이 된다. 그래서 위쪽 예제의 `color: string;` 선언과 `this.color = color;` 대입을 모두 생략할 수 있다. `readonly` 대신 `public color: string`으로 쓰면 나중에 값을 바꿀 수 있는 속성이 된다.

## 접근 제어자: public, protected, private

**접근 제어자**(access modifier)는 속성이나 메서드를 어디서 사용할 수 있는지 정한다. TypeScript에는 세 가지가 있다.

| 접근 제어자 | 클래스 내부 | 자식 클래스 | 인스턴스(클래스 바깥) |
| --- | --- | --- | --- |
| `public` (기본값) | O | O | O |
| `protected` | O | O | X |
| `private` | O | X | X |

아무것도 붙이지 않으면 `public`이다. 앞의 `color`도 `public`이므로 어디서든 읽을 수 있었다.

### protected

`protected`는 자기 클래스와 자식 클래스 안에서만 쓸 수 있다.

```ts
class Car {
    protected name: string = "car";
    color: string;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
        console.log(this.name);
    }
}

class Bmw extends Car {
    constructor(color: string) {
        super(color);
    }
    showName() {
        console.log(this.name); // 자식 클래스 안이므로 가능
    }
}

const z4 = new Bmw("black");
console.log(z4.name); // 에러
```

`Bmw`는 `Car`를 상속했으므로 `showName()` 안에서 `this.name`을 읽을 수 있다. 하지만 클래스 바깥에서 `z4.name`을 읽으면 `name`은 `Car`와 그 자식 클래스에서만 접근할 수 있다는 에러가 난다.

자식 클래스에서 부모의 속성을 읽을 때는 `super.name`이 아니라 `this.name`을 쓴다. `super`는 부모의 메서드를 부를 때 쓰는 것이고, `name` 같은 속성은 부모에서 선언했더라도 인스턴스 자신(`this`)에 들어 있다. `super.name`으로 쓰면 부모가 정의한 클래스 필드는 `super`로 접근할 수 없다는 에러가 난다.

### private

`private`은 그 클래스 안에서만 쓸 수 있다. 위 예제에서 `protected`를 `private`으로 바꾸면 `z4.name`뿐 아니라 `Bmw`의 `showName()` 안의 `this.name`도 에러가 난다. `name`은 `Car` 안에서만 접근할 수 있는 private 속성이라는 메시지다.

`private` 대신 이름 앞에 `#`을 붙이는 방법도 있다.

```ts
class Car {
    #name: string = "car"; // private name: string = "car"; 과 비슷
    color: string;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
        console.log(this.#name);
    }
}
```

`#name`은 JavaScript 표준 문법인 **private 필드**다. 클래스 바깥이나 자식 클래스에서 `this.#name`을 쓰면 `private`과 마찬가지로 에러가 난다. 사용할 때도 `this.#name`처럼 `#`까지 붙여 써야 한다.

두 방식의 차이는 검사 시점에 있다. `private`은 TypeScript 컴파일 단계에서만 막고, JavaScript로 변환된 뒤에는 평범한 속성이 된다. `#name`은 JavaScript 실행 중에도 바깥에서 접근할 수 없다.

## readonly: 읽기만 가능한 속성

`readonly`를 붙인 속성은 읽을 수는 있지만 값을 바꿀 수 없다.

```ts
class Car {
    readonly name: string = "car";
    color: string;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
        console.log(this.name);
    }
}

const z4 = new Car("black");
console.log(z4.name); // "car"
z4.name = "zzz4";     // 에러
```

`z4.name`을 읽는 것은 문제없지만, 값을 넣으면 `name`은 읽기 전용 속성이라 할당할 수 없다는 에러가 난다.

그렇다면 인스턴스마다 다른 이름을 주고 싶을 때는 어떻게 할까? `readonly` 속성은 **생성자 안에서는** 값을 넣을 수 있다. 생성자로 이름을 받아 대입하면 된다.

```ts
class Car {
    readonly name: string = "car";
    color: string;
    constructor(color: string, name: string) {
        this.color = color;
        this.name = name; // 생성자 안에서는 대입 가능
    }
}

class Bmw extends Car {
    constructor(color: string, name: string) {
        super(color, name);
    }
    showName() {
        console.log(this.name);
    }
}

const z4 = new Bmw("black", "zzz4");
console.log(z4.name); // "zzz4"
```

`Bmw`는 받은 `name`을 `super(color, name)`으로 부모 생성자에 넘기고, `Car`의 생성자가 `this.name`에 대입한다. 그래서 `z4.name`은 `"zzz4"`가 된다. 한 번 만들어진 뒤에는 여전히 바꿀 수 없다.

## static: 클래스 자체에 붙는 속성

지금까지의 속성은 `new`로 만든 인스턴스마다 따로 가지는 값이었다. 모든 자동차의 바퀴 수처럼 인스턴스와 상관없이 클래스에 하나만 있으면 되는 값은 `static`으로 선언한다. 이를 **정적 멤버**(static member)라고 한다.

```ts
class Car {
    color: string;
    static wheels = 4;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
        console.log(Car.wheels);
    }
}

const z4 = new Car("black");
console.log(Car.wheels); // 4
```

정적 멤버는 인스턴스가 아니라 클래스에 붙어 있으므로 `Car.wheels`처럼 **클래스 이름으로** 접근한다. 메서드 안에서도 `this.wheels`로 쓰면 `Car`에 `wheels` 속성이 없으니 정적 멤버인 `Car.wheels`로 접근하라는 에러가 난다.

## 추상 클래스

**추상 클래스**(abstract class)는 직접 인스턴스를 만들 수 없고, 상속받아서만 쓰는 클래스다. 클래스 앞에 `abstract`를 붙인다.

```ts
abstract class Car {
    color: string;
    constructor(color: string) {
        this.color = color;
    }
    start() {
        console.log("start");
    }
    abstract doSomething(): void;
}

const car = new Car("red"); // 에러
```

`new Car("red")`는 추상 클래스의 인스턴스를 만들 수 없다는 에러가 난다.

`abstract doSomething(): void;`처럼 `abstract`를 붙인 메서드를 **추상 메서드**라고 한다. 이름과 타입만 정하고 실제 동작은 비워 둔다. 동작은 상속받는 자식 클래스가 반드시 구현해야 한다.

```ts
class Bmw extends Car {
    constructor(color: string) {
        super(color);
    }
    doSomething() {
        console.log("do something");
    }
}

const z4 = new Bmw("black");
z4.start();       // "start"
z4.doSomething(); // "do something"
```

`Bmw`에서 `doSomething()`을 빼면, `Bmw`가 상속받은 추상 멤버 `doSomething`을 구현하지 않았다는 에러가 난다.

추상 클래스는 "자동차라면 `start()`는 이렇게 동작하고, `doSomething()`은 반드시 있어야 한다"처럼 공통 동작과 필수 규칙을 함께 정해 두고, 세부 구현은 차종마다 다르게 맡길 때 쓴다.

## 정리

TypeScript 클래스에서는 속성을 클래스 본문에 먼저 선언해야 한다. 생성자 매개변수 앞에 `public`이나 `readonly`를 붙이면 선언과 대입을 한 번에 처리할 수 있다.

접근 제어자는 `public`(어디서나), `protected`(자기와 자식 클래스), `private`(자기 클래스만) 순으로 범위가 좁아진다. `#name`은 실행 중에도 보호되는 JavaScript 표준 private 필드다. `readonly`는 생성자 밖에서 값을 바꾸지 못하게 하고, `static`은 인스턴스가 아니라 클래스에 붙어 `Car.wheels`처럼 클래스 이름으로 접근한다.

추상 클래스는 `new`로 직접 만들 수 없고, 추상 메서드는 자식 클래스가 반드시 구현해야 한다. 공통 틀은 부모가 정하고 세부 동작은 자식에게 맡기는 구조를 만들 때 사용한다.
